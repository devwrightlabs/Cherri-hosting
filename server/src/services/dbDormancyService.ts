/**
 * Phase 7 dormancy + snapshot/restore SEAMS.
 *
 * Activity signal: Railway `estimatedUsage` NETWORK_RX/TX as a coarse,
 * read-only, provider-side liveness proxy. We only ever record activity from a
 * real observed positive delta between polls — we NEVER guess activity from
 * missing/unreachable data, and we never mark an app dormant off data we don't
 * have.
 *
 * Snapshot -> delete -> restore is built as an honest INERT seam: Railway has no
 * native snapshot/restore, and no private snapshot store is configured yet, so
 * these operations record an honest *_PENDING status + reason and NEVER claim a
 * snapshot was stored or a database was deleted/restored. Customer DB dumps must
 * be encrypted into a PRIVATE store when this goes live — never public IPFS.
 *
 * None of this ever touches the IPFS front-end (Deployment), which stays live.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { isRailwayConfigured, getEstimatedUsage } from './railway';

export const ACTIVITY_SOURCE = 'RAILWAY_ESTIMATED_USAGE';

/** Minimum network-usage delta (GB) that counts as real activity. */
const NETWORK_EPSILON_GB = Number(
  process.env.DORMANCY_NETWORK_EPSILON_GB ?? 0.001,
);

export interface ActivityRefreshResult {
  updated: boolean;
  reason?: string;
  totalNetworkGb?: number;
  activityObserved?: boolean;
}

export interface SeamResult {
  effected: boolean;
  reason: string;
}

/** Is a real private snapshot store configured? (Deferred — always false now.) */
export function isSnapshotStoreConfigured(): boolean {
  return Boolean(process.env.SNAPSHOT_STORE_PROVIDER);
}

/**
 * Refresh one provisioned app's activity from Railway network usage. Honest
 * no-op (no timestamp changes) when the app isn't provisioned or Railway is
 * unconfigured/unreachable.
 */
export async function refreshActivity(
  serviceId: string,
): Promise<ActivityRefreshResult> {
  const svc = await prisma.backendService.findUnique({
    where: { id: serviceId },
  });
  if (!svc || !svc.railwayProjectId) {
    return { updated: false, reason: 'not provisioned' };
  }
  if (!isRailwayConfigured()) {
    return { updated: false, reason: 'railway not configured' };
  }

  let totalGb: number;
  try {
    const usage = await getEstimatedUsage({
      projectId: svc.railwayProjectId,
      measurements: ['NETWORK_RX_GB', 'NETWORK_TX_GB'],
    });
    totalGb = usage.reduce((a, u) => a + (Number(u.estimatedValue) || 0), 0);
  } catch (err) {
    // Provider unreachable -> do NOT touch activity state; stay honest.
    return { updated: false, reason: (err as Error).message };
  }

  const now = new Date();
  const prev = svc.lastNetworkUsageGb;
  const data: {
    dbActivityCheckedAt: Date;
    lastNetworkUsageGb: number;
    activitySource: string;
    activityBaselineAt?: Date;
    lastProviderActivityAt?: Date;
  } = {
    dbActivityCheckedAt: now,
    lastNetworkUsageGb: totalGb,
    activitySource: ACTIVITY_SOURCE,
  };

  // First successful observation: record WHEN monitoring truly began. Dormancy
  // is measured from this baseline (or a later observed-activity time) — never
  // from createdAt — so one first poll on an old service can't be misread as
  // days of inactivity.
  if (svc.activityBaselineAt == null) {
    data.activityBaselineAt = now;
  }

  // A real positive delta vs. the stored baseline means traffic happened since
  // the last poll. A lower value means the billing period reset — we just
  // re-baseline without claiming any activity time (we don't know when).
  let activityObserved = false;
  if (prev != null && totalGb - prev > NETWORK_EPSILON_GB) {
    data.lastProviderActivityAt = now;
    activityObserved = true;
  }

  await prisma.backendService.update({ where: { id: serviceId }, data });
  return { updated: true, totalNetworkGb: totalGb, activityObserved };
}

export async function markDormant(
  serviceId: string,
  reason: string,
): Promise<void> {
  await prisma.backendService.update({
    where: { id: serviceId },
    data: {
      dbLifecycleStatus: 'DORMANT_PENDING',
      dormantAt: new Date(),
      dormancyReason: reason,
    },
  });
  logger.info('DB flagged dormant (pending action)', { serviceId, reason });
}

/**
 * Dormant action: snapshot then delete the live DB to stop billing. INERT until
 * the snapshot/delete path is enabled AND a private store + a real provisioned
 * DB exist. Until then it records an honest PENDING snapshot + reason and leaves
 * the DB exactly as-is (never deleted, never marked SNAPSHOTTED).
 */
export async function snapshotAndDeleteDormant(
  serviceId: string,
): Promise<SeamResult> {
  const svc = await prisma.backendService.findUnique({
    where: { id: serviceId },
  });
  if (!svc) return { effected: false, reason: 'service not found' };

  const config = await prisma.operatorCostControlConfig.findUnique({
    where: { id: 'singleton' },
  });

  const blockers: string[] = [];
  if (!config?.snapshotDeleteEnabled) {
    blockers.push('snapshot/delete disabled in operator config');
  }
  if (!isSnapshotStoreConfigured()) {
    blockers.push('no private snapshot store configured');
  }
  if (!isRailwayConfigured()) blockers.push('Railway not configured');
  if (!svc.railwayDbServiceId) {
    blockers.push('no provisioned database to snapshot');
  }

  if (blockers.length > 0) {
    const reason = `Snapshot/delete not effected: ${blockers.join('; ')}.`;
    await prisma.dbSnapshot.create({
      data: { backendServiceId: serviceId, status: 'PENDING', failureReason: reason },
    });
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbDeleteFailureReason: reason },
    });
    logger.warn('Dormant snapshot/delete not effected', { serviceId, reason });
    return { effected: false, reason };
  }

  // Live path (deferred): EXPORTING -> encrypt -> private store -> checksum ->
  // STORED -> deleteService -> DELETE_PENDING -> DELETED. Snapshot MUST be
  // verifiably STORED before any delete. Until that path is implemented we
  // still degrade HONESTLY — record a PENDING snapshot + failure reason and
  // leave the DB exactly as-is (never SNAPSHOTTED/DELETED).
  const reason = 'Live snapshot/delete path pending implementation.';
  await prisma.dbSnapshot.create({
    data: { backendServiceId: serviceId, status: 'PENDING', failureReason: reason },
  });
  await prisma.backendService.update({
    where: { id: serviceId },
    data: { dbDeleteFailureReason: reason },
  });
  logger.warn('Dormant snapshot/delete not effected', { serviceId, reason });
  return { effected: false, reason };
}

/**
 * Wake a dormant/deleted DB on demand by restoring its snapshot. INERT: with no
 * STORED snapshot and no live provisioning it records an honest RESTORE_PENDING
 * + reason and NEVER claims the database was restored.
 */
export async function wakeDb(serviceId: string): Promise<SeamResult> {
  const svc = await prisma.backendService.findUnique({
    where: { id: serviceId },
  });
  if (!svc) return { effected: false, reason: 'service not found' };

  if (
    svc.dbLifecycleStatus !== 'DELETED' &&
    svc.dbLifecycleStatus !== 'SNAPSHOTTED'
  ) {
    return {
      effected: false,
      reason: `Nothing to wake (db status ${svc.dbLifecycleStatus}).`,
    };
  }

  const snapshot = await prisma.dbSnapshot.findFirst({
    where: { backendServiceId: serviceId, status: 'STORED' },
    orderBy: { createdAt: 'desc' },
  });
  if (!snapshot) {
    const reason = 'Wake unavailable: no STORED snapshot to restore from.';
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbRestoreFailureReason: reason },
    });
    return { effected: false, reason };
  }

  const reason =
    'Wake/restore not effected: live provisioning + snapshot store not available yet.';
  await prisma.backendService.update({
    where: { id: serviceId },
    data: { dbLifecycleStatus: 'RESTORE_PENDING', dbRestoreFailureReason: reason },
  });
  return { effected: false, reason };
}
