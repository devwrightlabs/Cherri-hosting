/**
 * Phase 11 — backend-provider (Railway) health monitor.
 *
 * The "landlord" that runs per-app backends + Postgres rides on Railway, which
 * has had multi-hour outages. We cannot prevent that, but we MUST surface it
 * honestly: an outage is shown as "the backend provider is down — your IPFS site
 * is still live", never as a generic error and never faked away.
 *
 * Design (per the Phase 11 plan):
 *  - In-memory tri-state monitor (no DB singleton): the status endpoint must work
 *    even if the DB is down, and a stale persisted "healthy" would be a lie.
 *  - Fed from TWO sources so it reflects reality cheaply:
 *      1. A periodic lightweight probe (a real READ against Railway).
 *      2. Observed outcomes of EVERY real Railway call (railway.ts reports here),
 *         so a live outage is detected the moment any call times out, not only at
 *         the next probe.
 *  - Honest classification: a successful call OR any HTTP/GraphQL/auth response
 *    means Railway is REACHABLE (it answered). Only a network error / timeout
 *    (RailwayApiError.isOutage, HTTP status 0) means UNREACHABLE.
 *
 * MASTER RULE — never reveal that Cherri uses Railway. The internal state may
 * hold raw provider detail for operator logs, but getRailwayHealth() (the only
 * client-facing shape) is fully sanitized: a generic "backend provider" message
 * with NO provider name, hostnames, IDs, or raw error text.
 *
 * Inert by default: the active probe only runs when the backend lane is live
 * (GO-LIVE master switch on) and Railway is configured — exactly like the other
 * reconcilers — so today, with the lane off, the monitor reports `unknown` and
 * makes no external calls.
 */
import { logger } from '../utils/logger';
import { isBackendLaneLive } from './goLiveService';
import {
  isRailwayConfigured,
  getConnectionStatus,
  setRailwayOutcomeObserver,
} from './railway';

export type RailwayReachability = 'unknown' | 'reachable' | 'unreachable';

interface MonitorState {
  configured: boolean;
  state: RailwayReachability;
  lastCheckedAt: number | null;
  lastReachableAt: number | null;
  lastOutageAt: number | null;
  /** Raw, operator-only detail. NEVER returned to clients. */
  rawReason: string | null;
}

/** Client-safe health snapshot. Contains NO provider name/host/id/raw error. */
export interface BackendProviderHealth {
  /** true = up, false = outage, null = not actively monitored (lane off/unknown). */
  operational: boolean | null;
  state: 'operational' | 'outage' | 'unknown';
  /** Generic, user-facing message. Safe to show directly. */
  message: string;
}

const state: MonitorState = {
  configured: false,
  state: 'unknown',
  lastCheckedAt: null,
  lastReachableAt: null,
  lastOutageAt: null,
  rawReason: null,
};

/**
 * Record the outcome of a real Railway call (wired as railway.ts's observer).
 *  - ok:true                -> reachable (Railway answered successfully)
 *  - ok:false, isOutage     -> unreachable (network/timeout; provider outage)
 *  - ok:false, !isOutage    -> reachable (Railway answered with an error)
 */
export function recordRailwayOutcome(outcome: {
  ok: boolean;
  isOutage: boolean;
  reason?: string;
}): void {
  const now = Date.now();
  state.configured = true;
  state.lastCheckedAt = now;
  if (outcome.isOutage) {
    if (state.state !== 'unreachable') {
      logger.warn('Backend provider appears UNREACHABLE (outage/timeout)', {
        reason: outcome.reason,
      });
    }
    state.state = 'unreachable';
    state.lastOutageAt = now;
    state.rawReason = outcome.reason ?? 'Provider unreachable (network/timeout).';
  } else {
    if (state.state === 'unreachable') {
      logger.info('Backend provider reachable again (outage cleared)');
    }
    state.state = 'reachable';
    state.lastReachableAt = now;
    state.rawReason = null;
  }
}

/** True when the monitor currently believes Railway is unreachable. */
export function isRailwayUnreachable(): boolean {
  return state.state === 'unreachable';
}

const OUTAGE_MESSAGE =
  'Backend provider is experiencing an outage — your sites on IPFS are still ' +
  'live; backend and database features are temporarily unavailable.';

/**
 * The ONLY client-facing health shape. Sanitized: no provider name, hostnames,
 * IDs, or raw error text ever crosses this boundary.
 */
export function getRailwayHealth(): BackendProviderHealth {
  if (state.state === 'unreachable') {
    return { operational: false, state: 'outage', message: OUTAGE_MESSAGE };
  }
  if (state.state === 'reachable') {
    return {
      operational: true,
      state: 'operational',
      message: 'Backend provider is operational.',
    };
  }
  return {
    operational: null,
    state: 'unknown',
    message: 'Backend provider status is not being monitored.',
  };
}

/** Operator-only internal snapshot (may contain raw reason). Never sent to clients. */
export function getRailwayMonitorInternal(): Readonly<MonitorState> {
  return state;
}

const PROBE_TICK_MS = Math.max(
  15_000,
  Number(process.env.RAILWAY_PROBE_TICK_MS ?? 60_000),
);

let timer: NodeJS.Timeout | null = null;

/**
 * One probe pass. Inert unless the backend lane is live AND Railway is
 * configured — when inert it makes NO external call and leaves state `unknown`.
 * The real call inside getConnectionStatus() flows through railwayRequest, whose
 * observer updates the monitor, so we don't double-record here.
 */
export async function runRailwayProbe(): Promise<void> {
  if (!(await isBackendLaneLive())) return;
  if (!isRailwayConfigured()) return;
  // getConnectionStatus never throws; its underlying call reports the real
  // outcome to recordRailwayOutcome via the observer.
  await getConnectionStatus();
}

/** Start the periodic probe loop (once per process). Wires the call observer. */
export function startRailwayProbe(): void {
  // Always observe real call outcomes, even before/without the probe loop.
  setRailwayOutcomeObserver(recordRailwayOutcome);
  if (timer) return;
  timer = setInterval(() => {
    runRailwayProbe().catch((err) =>
      logger.error('Railway probe tick failed', {
        error: (err as Error).message,
      }),
    );
  }, PROBE_TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Railway status monitor started', { tickMs: PROBE_TICK_MS });
}

export function stopRailwayProbe(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test seam: reset monitor state to pristine `unknown`. */
export function __resetRailwayMonitor(): void {
  state.configured = false;
  state.state = 'unknown';
  state.lastCheckedAt = null;
  state.lastReachableAt = null;
  state.lastOutageAt = null;
  state.rawReason = null;
}
