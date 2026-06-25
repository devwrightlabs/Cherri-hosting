/**
 * Phase 10 periodic backup reconciler. On each tick, for every LIVE provisioned
 * DB, it attempts one non-destructive backup that is past its interval.
 *
 * Mirrors the dormancy/billing reconciler pattern: self-skips safely, errors are
 * isolated per-app, and it NEVER fakes a backup. It is gated twice — on the
 * backend lane being live and on the databaseBackups capability — and createBackup
 * itself self-blocks honestly when the live DB seam is unavailable, so today it is
 * fully coded yet completely inert (no live DB to export).
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { isBackendLaneLive, isCapabilityEnabled } from './goLiveService';
import { createBackup } from './backupService';

const TICK_MS = Number(process.env.BACKUP_TICK_MS ?? 3_600_000); // hourly sweep
// Minimum spacing between AUTO backups of the same DB (default daily).
const INTERVAL_MS = Number(process.env.BACKUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);

export async function runBackupTick(): Promise<void> {
  // GO-LIVE gates: the backend lane must be live AND the non-destructive
  // databaseBackups capability enabled before we touch any provider/store.
  if (!(await isBackendLaneLive())) return;
  if (!(await isCapabilityEnabled('databaseBackups'))) return;

  const now = Date.now();
  const live = await prisma.backendService.findMany({
    where: { railwayDbServiceId: { not: null }, dbLifecycleStatus: 'LIVE' },
    select: { id: true, lastBackupAt: true },
  });

  for (const s of live) {
    // Skip DBs backed up within the interval; AUTO backups are spaced apart.
    if (s.lastBackupAt && now - s.lastBackupAt.getTime() < INTERVAL_MS) continue;
    try {
      await createBackup(s.id, 'AUTO');
    } catch (err) {
      logger.warn('Backup reconciler: createBackup threw', {
        serviceId: s.id,
        error: (err as Error).message,
      });
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startBackupReconciler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runBackupTick().catch((err) =>
      logger.error('Backup reconciler tick failed', { error: (err as Error).message }),
    );
  }, TICK_MS);
  // Don't keep the process alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Backup reconciler started', { tickMs: TICK_MS });
}

export function stopBackupReconciler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
