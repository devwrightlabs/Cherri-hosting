/**
 * Phase 10 user-facing periodic Postgres backups — NON-DESTRUCTIVE data safety.
 *
 * This is deliberately distinct from the Phase 7 cost-control snapshot path
 * (snapshotService.snapshotAndDelete): a backup ONLY preserves a point-in-time
 * copy so a provider failure or a dormant-DB restore can never lose user data —
 * it NEVER deletes the live DB.
 *
 * Honesty guarantees:
 *   - A backup is only ever recorded STORED after a real export -> encrypt ->
 *     store.put -> checksum verify all succeed. Anything short of that is FAILED
 *     or an honest PENDING with a reason; we NEVER fake a STORED backup.
 *   - Raw dumps are encrypted and only ever written to a configured PRIVATE
 *     store — never to public IPFS.
 *   - Gated on the `databaseBackups` capability and on a resolvable live DB URI
 *     (shared seam). The seam returns null until live provisioning surfaces a
 *     URI, so today the whole path self-blocks honestly and stays inert.
 *   - The DB connection string is never logged.
 */
import crypto from 'crypto';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { getCapabilityReadiness } from './goLiveService';
import { dumpDatabase, encryptSnapshot } from './snapshotService';
import { resolveSnapshotStore, type SnapshotStore } from './snapshotStore';
import { resolveLiveDbUri } from './dbConnectionSeam';

export interface BackupResult {
  /** True only when a real, verified backup was STORED. */
  effected: boolean;
  reason: string;
  backupId?: string;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Record an honest non-effected backup: a PENDING row carrying the human reason,
 * and reflect it on the service so the UI can show "not backed up yet — why".
 * Never throws; the caller already decided this is a clean, non-fake skip.
 */
async function recordBackupBlocked(
  serviceId: string,
  kind: 'AUTO' | 'MANUAL',
  reason: string,
): Promise<BackupResult> {
  const backup = await prisma.dbBackup.create({
    data: { backendServiceId: serviceId, kind, status: 'PENDING', failureReason: reason },
  });
  await prisma.backendService.update({
    where: { id: serviceId },
    data: { lastBackupStatus: 'PENDING', lastBackupFailureReason: reason },
  });
  logger.warn('DB backup not effected', { serviceId, reason });
  return { effected: false, reason, backupId: backup.id };
}

/**
 * Create one backup for a backend service. Returns an honest result: effected
 * only when a verified copy was STORED; otherwise a PENDING/FAILED row with the
 * reason. Safe to call from a scheduler or a manual trigger.
 */
export async function createBackup(
  serviceId: string,
  kind: 'AUTO' | 'MANUAL' = 'AUTO',
): Promise<BackupResult> {
  const svc = await prisma.backendService.findUnique({ where: { id: serviceId } });
  if (!svc) return { effected: false, reason: 'Backup not effected: service not found.' };

  // GO-LIVE gate: backups read a live DB and write to a private store — both live
  // actions. Stay inert until the non-destructive databaseBackups capability is on.
  const readiness = await getCapabilityReadiness('databaseBackups');
  if (!readiness.enabled) {
    return recordBackupBlocked(
      serviceId,
      kind,
      `Backup not effected: ${readiness.blockedReason ?? 'databaseBackups capability is not enabled'}.`,
    );
  }

  // No provisioned DB => nothing to back up (honest, not a failure).
  if (!svc.railwayDbServiceId) {
    return recordBackupBlocked(
      serviceId,
      kind,
      'Backup not effected: no provisioned database to back up yet.',
    );
  }

  // Private encrypted store is mandatory. null => unconfigured (honest skip);
  // a thrown SnapshotStoreError => misconfigured (honest skip with the reason).
  let store: SnapshotStore;
  try {
    const resolved = resolveSnapshotStore();
    if (!resolved) {
      return recordBackupBlocked(
        serviceId,
        kind,
        'Backup not effected: no private snapshot store is configured.',
      );
    }
    store = resolved;
  } catch (err) {
    return recordBackupBlocked(serviceId, kind, `Backup not effected: ${(err as Error).message}`);
  }

  // The live DB URI seam. Null until the provisioning path surfaces it — so today
  // this is the honest stopping point and no backup is ever faked.
  const dbUri = await resolveLiveDbUri(svc);
  if (!dbUri) {
    return recordBackupBlocked(
      serviceId,
      kind,
      'Backup not effected: live database connection is not available to export.',
    );
  }

  // We have everything needed for a REAL backup. Mark EXPORTING, then only ever
  // reach STORED after the bytes are verified intact in the private store.
  const backup = await prisma.dbBackup.create({
    data: { backendServiceId: serviceId, kind, status: 'EXPORTING' },
  });
  try {
    const dump = await dumpDatabase(dbUri);
    const encrypted = encryptSnapshot(dump);
    const checksum = sha256(encrypted);
    const key = `backups/${serviceId}/${backup.id}.enc`;

    const stored = await store.put(key, encrypted);
    const intact =
      stored.checksum === checksum && (await store.verify(stored.locationRef, checksum));
    if (!intact) {
      throw new Error('stored backup failed checksum verification');
    }

    await prisma.dbBackup.update({
      where: { id: backup.id },
      data: {
        status: 'STORED',
        storageProvider: store.provider,
        locationRef: stored.locationRef,
        checksum,
        sizeBytes: BigInt(stored.sizeBytes),
        encrypted: true,
        failureReason: null,
      },
    });
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { lastBackupAt: new Date(), lastBackupStatus: 'STORED', lastBackupFailureReason: null },
    });
    logger.info('DB backup STORED', { serviceId, backupId: backup.id, kind });
    return { effected: true, reason: 'backup STORED', backupId: backup.id };
  } catch (err) {
    // The raw provider/pg_dump error can contain a DB host or other internal
    // detail, so it is kept ONLY on the internal DbBackup row and in server logs.
    // The owner-facing lastBackupFailureReason stays a generic, non-leaky message.
    const detail = `Backup export failed: ${(err as Error).message}`;
    const ownerFacing =
      'The most recent backup did not complete. We will retry automatically.';
    await prisma.dbBackup.update({
      where: { id: backup.id },
      data: { status: 'FAILED', failureReason: detail },
    });
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { lastBackupStatus: 'FAILED', lastBackupFailureReason: ownerFacing },
    });
    logger.warn('DB backup export failed', { serviceId, backupId: backup.id });
    return { effected: false, reason: detail, backupId: backup.id };
  }
}
