/**
 * Cherri Watchdog — uptime/health monitor for sites customers host.
 *
 * On a configurable interval (default 60 s) it fetches each ACTIVE deployment's
 * public URL (gateway URL and/or Pi custom domain). It records the HTTP status
 * code + response time, maintains a rolling history, and opens/closes incidents
 * when state changes.
 *
 * Design principles:
 *   - If the database is absent the service emits a startup warning and becomes
 *     a no-op; it NEVER crashes the process.
 *   - All external HTTP checks use a short timeout (8 s) so a slow site does not
 *     block the scheduler.
 *   - The interval handle is returned so index.ts can clear it on graceful shutdown.
 */
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { logger } from '../utils/logger';
import { isDatabaseConfigured } from '../utils/integrations';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WatchdogStatus = 'up' | 'down' | 'degraded';

export interface WatchdogCheckResult {
  deploymentId: string;
  url: string;
  status: WatchdogStatus;
  httpCode: number | null;
  responseTimeMs: number;
  checkedAt: Date;
}

export interface WatchdogIncidentShape {
  id: string;
  deploymentId: string;
  url: string;
  openedAt: Date;
  closedAt: Date | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Lazy prisma import — guarded so the service stays inert without DB
// ---------------------------------------------------------------------------

let _prisma: import('../utils/prismaClient').PrismaClientType | null = null;

async function getDb() {
  if (!isDatabaseConfigured()) return null;
  if (!_prisma) {
    const m = await import('../utils/prismaClient');
    _prisma = m.prisma;
  }
  return _prisma;
}

// ---------------------------------------------------------------------------
// HTTP probe (no external deps)
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 8_000;

function probe(url: string): Promise<{ httpCode: number; responseTimeMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error(`Invalid URL: ${url}`));
      return;
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      { hostname: parsed.hostname, port: parsed.port || undefined, path: parsed.pathname + parsed.search, method: 'HEAD', timeout: PROBE_TIMEOUT_MS },
      (res) => {
        res.resume(); // drain
        resolve({ httpCode: res.statusCode ?? 0, responseTimeMs: Date.now() - start });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function classify(httpCode: number | null, err?: unknown): WatchdogStatus {
  if (err || httpCode === null) return 'down';
  if (httpCode >= 500) return 'degraded';
  if (httpCode >= 200 && httpCode < 400) return 'up';
  return 'degraded';
}

// ---------------------------------------------------------------------------
// Core check for a single deployment
// ---------------------------------------------------------------------------

async function checkDeployment(
  deploymentId: string,
  url: string,
): Promise<WatchdogCheckResult> {
  let httpCode: number | null = null;
  let responseTimeMs = 0;
  let probeErr: unknown;
  try {
    const result = await probe(url);
    httpCode = result.httpCode;
    responseTimeMs = result.responseTimeMs;
  } catch (err) {
    probeErr = err;
    responseTimeMs = PROBE_TIMEOUT_MS;
  }
  const status = classify(httpCode, probeErr);
  return { deploymentId, url, status, httpCode, responseTimeMs, checkedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Persist check + manage incidents
// ---------------------------------------------------------------------------

async function persistCheck(result: WatchdogCheckResult): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Record the check
    await (db as any).watchdogCheck.create({
      data: {
        deploymentId: result.deploymentId,
        url: result.url,
        status: result.status,
        httpCode: result.httpCode,
        responseTimeMs: result.responseTimeMs,
        checkedAt: result.checkedAt,
      },
    });

    // Open/close incidents on state change
    const latestIncident = await (db as any).watchdogIncident.findFirst({
      where: { deploymentId: result.deploymentId, closedAt: null },
      orderBy: { openedAt: 'desc' },
    });

    if (result.status !== 'up' && !latestIncident) {
      // Site went down / degraded — open an incident
      await (db as any).watchdogIncident.create({
        data: {
          deploymentId: result.deploymentId,
          url: result.url,
          reason: `Status ${result.status}; HTTP ${result.httpCode ?? 'N/A'}`,
        },
      });
      logger.warn('Watchdog: incident opened', { deploymentId: result.deploymentId, status: result.status });
    } else if (result.status === 'up' && latestIncident) {
      // Site recovered — close the incident
      await (db as any).watchdogIncident.update({
        where: { id: latestIncident.id },
        data: { closedAt: new Date() },
      });
      logger.info('Watchdog: incident closed (site recovered)', { deploymentId: result.deploymentId });
    }
  } catch (err) {
    logger.error('Watchdog: failed to persist check result', { error: err, deploymentId: result.deploymentId });
  }
}

// ---------------------------------------------------------------------------
// Main tick — runs for all ACTIVE deployments
// ---------------------------------------------------------------------------

export async function runWatchdogTick(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  let deployments: Array<{ id: string; gateway: string; status: string }>;
  try {
    deployments = await (db as any).deployment.findMany({
      where: { status: 'ACTIVE', gateway: { not: '' } },
      select: { id: true, gateway: true, status: true },
    });
  } catch (err) {
    logger.error('Watchdog: failed to fetch deployments', { error: err });
    return;
  }

  if (deployments.length === 0) return;

  // Run checks in parallel (fire-and-forget errors are caught per-deployment)
  await Promise.allSettled(
    deployments.map(async (dep) => {
      try {
        const result = await checkDeployment(dep.id, dep.gateway);
        await persistCheck(result);
      } catch (err) {
        logger.error('Watchdog: check failed', { deploymentId: dep.id, error: err });
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Start scheduler
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 60_000;

export function startWatchdog(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout | null {
  if (!isDatabaseConfigured()) {
    logger.warn('Watchdog: database not configured — monitoring disabled');
    return null;
  }
  logger.info(`Watchdog: starting uptime monitor (interval ${intervalMs / 1000}s)`);
  // Run an initial tick soon after startup, then on interval.
  const initialDelay = setTimeout(() => runWatchdogTick(), 15_000);
  const handle = setInterval(() => runWatchdogTick(), intervalMs);
  // Also clear the initial delay if shutdown happens before it fires — we store
  // both but only return the interval handle (the initial delay is short-lived).
  (handle as any).__initialDelay = initialDelay;
  return handle;
}

// ---------------------------------------------------------------------------
// Query helpers (used by routes)
// ---------------------------------------------------------------------------

/** Uptime % from checks in the last N hours. */
async function uptimePercent(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  deploymentId: string,
  hours = 24,
): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000);
  const checks = await (db as any).watchdogCheck.findMany({
    where: { deploymentId, checkedAt: { gte: since } },
    select: { status: true },
  });
  if (checks.length === 0) return 100; // No data = optimistic 100%
  const upCount = checks.filter((c: { status: string }) => c.status === 'up').length;
  return Math.round((upCount / checks.length) * 10_000) / 100;
}

/** Summary per deployment for the authed user. */
export async function getWatchdogSummary(userId: string): Promise<unknown> {
  const db = await getDb();
  if (!db) return { monitoringDisabled: true, deployments: [] };

  try {
    // Get all deployments for user's projects
    const projects = await (db as any).project.findMany({
      where: { userId, lifecycleStatus: 'ACTIVE' },
      select: { id: true, name: true },
    });
    const projectIds = projects.map((p: { id: string }) => p.id);

    const deployments = await (db as any).deployment.findMany({
      where: { projectId: { in: projectIds }, status: 'ACTIVE', gateway: { not: '' } },
      select: { id: true, gateway: true, projectId: true, createdAt: true },
    });

    const results = await Promise.all(
      deployments.map(async (dep: { id: string; gateway: string; projectId: string; createdAt: Date }) => {
        const project = projects.find((p: { id: string; name: string }) => p.id === dep.projectId);

        // Latest check
        const latestCheck = await (db as any).watchdogCheck.findFirst({
          where: { deploymentId: dep.id },
          orderBy: { checkedAt: 'desc' },
        });

        // Open incident
        const openIncident = await (db as any).watchdogIncident.findFirst({
          where: { deploymentId: dep.id, closedAt: null },
          orderBy: { openedAt: 'desc' },
        });

        const uptime = await uptimePercent(db, dep.id);

        return {
          deploymentId: dep.id,
          projectName: project?.name ?? 'Unknown',
          url: dep.gateway,
          status: latestCheck?.status ?? 'unknown',
          httpCode: latestCheck?.httpCode ?? null,
          responseTimeMs: latestCheck?.responseTimeMs ?? null,
          lastCheckedAt: latestCheck?.checkedAt ?? null,
          uptimePercent24h: uptime,
          hasOpenIncident: Boolean(openIncident),
          openIncidentSince: openIncident?.openedAt ?? null,
        };
      }),
    );

    return { monitoringDisabled: false, deployments: results };
  } catch (err) {
    logger.error('Watchdog: getWatchdogSummary failed', { error: err });
    return { monitoringDisabled: false, deployments: [], error: 'Failed to load monitoring data' };
  }
}

/** Incident timeline for a specific deployment. */
export async function getDeploymentIncidents(
  deploymentId: string,
  userId: string,
): Promise<unknown> {
  const db = await getDb();
  if (!db) return { monitoringDisabled: true, incidents: [] };

  try {
    // Verify ownership
    const dep = await (db as any).deployment.findFirst({
      where: { id: deploymentId },
      select: { id: true, project: { select: { userId: true } } },
    });
    if (!dep || dep.project.userId !== userId) {
      return { error: 'not_found', incidents: [] };
    }

    const incidents = await (db as any).watchdogIncident.findMany({
      where: { deploymentId },
      orderBy: { openedAt: 'desc' },
      take: 50,
    });

    const checks = await (db as any).watchdogCheck.findMany({
      where: { deploymentId },
      orderBy: { checkedAt: 'desc' },
      take: 100,
    });

    return {
      monitoringDisabled: false,
      deploymentId,
      incidents,
      recentChecks: checks,
      uptimePercent24h: await uptimePercent(db, deploymentId),
    };
  } catch (err) {
    logger.error('Watchdog: getDeploymentIncidents failed', { error: err });
    return { monitoringDisabled: false, incidents: [], error: 'Failed to load incident data' };
  }
}

/** Manual re-check for a specific deployment. */
export async function manualRecheck(
  deploymentId: string,
  userId: string,
): Promise<unknown> {
  const db = await getDb();
  if (!db) return { monitoringDisabled: true };

  try {
    // Verify ownership
    const dep = await (db as any).deployment.findFirst({
      where: { id: deploymentId, status: 'ACTIVE' },
      select: { id: true, gateway: true, project: { select: { userId: true } } },
    });
    if (!dep || dep.project.userId !== userId) {
      return { error: 'not_found' };
    }
    if (!dep.gateway) {
      return { error: 'no_url' };
    }

    const result = await checkDeployment(dep.id, dep.gateway);
    await persistCheck(result);
    return { status: result.status, httpCode: result.httpCode, responseTimeMs: result.responseTimeMs, checkedAt: result.checkedAt };
  } catch (err) {
    logger.error('Watchdog: manualRecheck failed', { error: err });
    return { error: 'check_failed' };
  }
}
