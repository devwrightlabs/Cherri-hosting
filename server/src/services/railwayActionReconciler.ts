/**
 * Phase 11 — backend-provider (Railway) outage retry reconciler.
 *
 * When the landlord (Railway) has an outage, in-flight provider actions are NOT
 * faked or failed — they are recorded as retryable: provisioning stays
 * PROVISIONING with a scheduled retry, and pause/resume stay PAUSE_PENDING /
 * RESUME_PENDING. This reconciler re-drives those once the provider is back, so
 * the system self-heals without any user action.
 *
 * Gating (all must hold before it touches the provider at all):
 *   1. The backend lane is live (GO-LIVE master switch on).
 *   2. The `provisioning` capability is enabled.
 *   3. The provider is currently REACHABLE (the in-memory monitor is not in an
 *      outage state) — retrying mid-outage would just time out repeatedly.
 *
 * Each re-driven action goes through the EXACT same verified code paths as the
 * first attempt, so every honesty guarantee is preserved (ACTIVE/PAUSED only
 * after a real, verified provider result). Like the other reconcilers it
 * self-skips today (lane off) and is therefore completely inert until GO-LIVE.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { isBackendLaneLive, isCapabilityEnabled } from './goLiveService';
import { isRailwayUnreachable } from './railwayStatusMonitor';
import { resumeProvisioning } from './provisioningService';
import { retryPendingProviderActions } from './appLifecycleService';

const TICK_MS = Number(process.env.RAILWAY_RETRY_TICK_MS ?? 60_000);

export async function runRailwayRetryTick(): Promise<void> {
  // GO-LIVE gates — identical to the other reconcilers.
  if (!(await isBackendLaneLive())) return;
  if (!(await isCapabilityEnabled('provisioning'))) return;
  // Don't hammer the provider while it is in a known outage; wait for recovery.
  if (isRailwayUnreachable()) return;

  // 1. Re-drive provisioning rows whose retry time is due.
  const now = new Date();
  const due = await prisma.backendService.findMany({
    where: {
      status: 'PROVISIONING',
      provisioningNextRetryAt: { not: null, lte: now },
    },
    select: { id: true },
  });
  for (const row of due) {
    try {
      await resumeProvisioning(row.id);
    } catch (err) {
      logger.warn('Provisioning retry threw', {
        backendServiceId: row.id,
        error: (err as Error).message,
      });
    }
  }

  // 2. Re-drive pause/resume actions that were deferred by the outage.
  try {
    await retryPendingProviderActions();
  } catch (err) {
    logger.warn('Pause/resume retry threw', { error: (err as Error).message });
  }
}

let timer: NodeJS.Timeout | null = null;

export function startRailwayActionReconciler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runRailwayRetryTick().catch((err) =>
      logger.error('Railway retry reconciler tick failed', {
        error: (err as Error).message,
      }),
    );
  }, TICK_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Railway action retry reconciler started', { tickMs: TICK_MS });
}

export function stopRailwayActionReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
