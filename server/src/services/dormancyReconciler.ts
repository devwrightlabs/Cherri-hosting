/**
 * Phase 7 dormancy reconciler. Periodically:
 *   1. refreshes provider-side activity for every LIVE provisioned DB (honest
 *      no-op when Railway is unreachable),
 *   2. flags as DORMANT_PENDING only those DBs with a real, fresh activity
 *      signal that shows >= inactivityDays of no traffic, and
 *   3. runs the snapshot/delete seam ONLY when the operator has enabled it
 *      (otherwise dormant DBs are merely flagged, never touched).
 *
 * Mirrors the billing-lifecycle reconciler pattern: self-skips safely, errors
 * are isolated per-app, and it never marks dormancy off missing/stale data.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { getCostControlConfig } from './costControlService';
import { isCapabilityEnabled } from './goLiveService';
import {
  ACTIVITY_SOURCE,
  refreshActivity,
  markDormant,
  snapshotAndDeleteDormant,
} from './dbDormancyService';

const TICK_MS = Number(process.env.DORMANCY_TICK_MS ?? 3_600_000); // hourly
// Don't mark dormancy off stale polling: require a successful poll within this
// window so an extended Railway outage can't trigger false dormancy.
const FRESHNESS_MS = Number(
  process.env.DORMANCY_FRESHNESS_MS ?? 2 * 24 * 60 * 60 * 1000,
);
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runDormancyTick(): Promise<void> {
  // GO-LIVE gate: dormancy detection polls the provider and flags DBs — a live
  // action. Stay inert until the dormancyDetection capability is enabled. The
  // destructive snapshot/delete is additionally gated inside snapshotAndDelete.
  if (!(await isCapabilityEnabled('dormancyDetection'))) return;

  const config = await getCostControlConfig();

  // 1) Refresh activity for every live provisioned DB.
  const live = await prisma.backendService.findMany({
    where: { railwayDbServiceId: { not: null }, dbLifecycleStatus: 'LIVE' },
    select: { id: true },
  });
  for (const s of live) {
    try {
      await refreshActivity(s.id);
    } catch (err) {
      logger.warn('Dormancy: activity refresh failed', {
        serviceId: s.id,
        error: (err as Error).message,
      });
    }
  }

  // 2) Evaluate dormancy from REAL, fresh signals only. A candidate must have
  //    an established activity baseline (activityBaselineAt) — we never measure
  //    inactivity from createdAt, so a single first poll on an old service can't
  //    be misread as days of inactivity.
  const candidates = await prisma.backendService.findMany({
    where: {
      railwayDbServiceId: { not: null },
      dbLifecycleStatus: 'LIVE',
      activitySource: ACTIVITY_SOURCE,
      activityBaselineAt: { not: null },
    },
    select: {
      id: true,
      activityBaselineAt: true,
      lastProviderActivityAt: true,
      dbActivityCheckedAt: true,
    },
  });

  const now = Date.now();
  const cutoffMs = config.inactivityDays * DAY_MS;

  for (const s of candidates) {
    // Stale polling => we can't honestly judge activity; skip.
    if (
      !s.dbActivityCheckedAt ||
      now - s.dbActivityCheckedAt.getTime() > FRESHNESS_MS
    ) {
      continue;
    }
    // Inactivity is measured from the last observed activity, or — if none was
    // ever observed — from when monitoring began (the baseline). Never createdAt.
    const reference = (s.lastProviderActivityAt ?? s.activityBaselineAt!).getTime();
    if (now - reference < cutoffMs) continue;

    try {
      await markDormant(
        s.id,
        `No provider network activity for >= ${config.inactivityDays}d`,
      );
      if (config.snapshotDeleteEnabled) {
        await snapshotAndDeleteDormant(s.id);
      }
    } catch (err) {
      logger.warn('Dormancy: failed to process dormant candidate', {
        serviceId: s.id,
        error: (err as Error).message,
      });
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startDormancyReconciler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runDormancyTick().catch((err) =>
      logger.error('Dormancy reconciler tick failed', {
        error: (err as Error).message,
      }),
    );
  }, TICK_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Dormancy reconciler started', { tickMs: TICK_MS });
}

export function stopDormancyReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
