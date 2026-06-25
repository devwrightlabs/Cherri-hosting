/**
 * Phase 7 snapshot -> delete -> restore LIVE orchestration (sub-gated, inert).
 *
 * This is the destructive cost-control path: when a provisioned DB has been idle
 * long enough, dump it to a PRIVATE encrypted store, then delete the live DB to
 * stop billing; later, wake it by restoring that snapshot. None of this ever
 * touches the IPFS front-end (Deployment), which stays live throughout.
 *
 * Honesty / ordering guarantees (WOODSTICK 3 master rules):
 *   - Fully gated on the `dormancySnapshotDelete` capability: GO-LIVE on AND
 *     Railway + operator snapshotDeleteEnabled + a PRIVATE store + an encryption
 *     key all present. Until then every call takes the honest blocked path
 *     (PENDING snapshot row + reason) and NEVER exports, deletes, or restores.
 *   - The live DB is deleted ONLY after a snapshot is verifiably STORED
 *     (uploaded AND checksum-verified). A failed/partial export leaves the DB
 *     exactly as-is.
 *   - A restore only marks LIVE after the downloaded bytes match the stored
 *     checksum, decrypt, restore, and a real connection check all succeed.
 *   - With no concrete store adapter implemented and no live DB connection, the
 *     pipeline self-blocks honestly — it is coded but stays inert.
 */
import crypto from 'crypto';
import { spawn } from 'child_process';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { getCapabilityReadiness } from './goLiveService';
import { deleteService } from './railway';
import {
  resolveSnapshotStore,
  type SnapshotStore,
} from './snapshotStore';
import { resolveLiveDbUri, resolveRestoreTargetUri } from './dbConnectionSeam';

export interface SeamResult {
  effected: boolean;
  reason: string;
}

// ─── Crypto (at-rest encryption for dumps) ───────────────────────────────────

const ENC_ALGO = 'aes-256-gcm';

function snapshotKey(): Buffer {
  const raw = process.env.SNAPSHOT_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('SNAPSHOT_ENCRYPTION_KEY is not set.');
  // Derive a fixed-length key so any operator-supplied passphrase works.
  return crypto.scryptSync(raw, 'cherri-snapshot-v1', 32);
}

/** Encrypt a dump for at-rest storage. Layout: iv(12) || authTag(16) || cipher. */
export function encryptSnapshot(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, snapshotKey(), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

export function decryptSnapshot(buf: Buffer): Buffer {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ENC_ALGO, snapshotKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─── Postgres dump/restore/verify via CLI (binary-safe) ──────────────────────

function runCapture(cmd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out));
      } else {
        reject(
          new Error(
            `${cmd} exited ${code}: ${Buffer.concat(err).toString().slice(0, 500)}`,
          ),
        );
      }
    });
    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export function dumpDatabase(uri: string): Promise<Buffer> {
  return runCapture('pg_dump', ['-Fc', '--no-owner', '--no-privileges', uri]);
}

export async function restoreDatabase(uri: string, dump: Buffer): Promise<void> {
  await runCapture(
    'pg_restore',
    ['--clean', '--if-exists', '--no-owner', '--no-privileges', '-d', uri],
    dump,
  );
}

export async function verifyDbConnection(uri: string): Promise<void> {
  await runCapture('psql', [uri, '-t', '-c', 'select 1']);
}

// ─── DB connection seams (populated by the live provisioning path) ────────────
// Resolved through the shared dbConnectionSeam module so snapshots and Phase 10
// backups always read the DB from the exact same source and can never diverge.

// ─── Honest blocked-path recorders ───────────────────────────────────────────

async function recordSnapshotBlocked(
  serviceId: string,
  reason: string,
): Promise<SeamResult> {
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

async function recordRestoreBlocked(
  serviceId: string,
  reason: string,
): Promise<SeamResult> {
  await prisma.backendService.update({
    where: { id: serviceId },
    data: { dbRestoreFailureReason: reason },
  });
  logger.warn('Wake/restore not effected', { serviceId, reason });
  return { effected: false, reason };
}

// ─── Orchestration ───────────────────────────────────────────────────────────

/**
 * Snapshot a dormant DB to the private store, then delete the live DB to stop
 * billing. Blocked => honest PENDING, never any export/delete. The delete only
 * runs after the snapshot is verifiably STORED.
 */
export async function snapshotAndDelete(serviceId: string): Promise<SeamResult> {
  const svc = await prisma.backendService.findUnique({ where: { id: serviceId } });
  if (!svc) return { effected: false, reason: 'service not found' };

  const readiness = await getCapabilityReadiness('dormancySnapshotDelete');
  if (!readiness.enabled) {
    return recordSnapshotBlocked(
      serviceId,
      `Snapshot/delete not effected: ${readiness.blockedReason}.`,
    );
  }
  if (!svc.railwayDbServiceId) {
    return recordSnapshotBlocked(
      serviceId,
      'Snapshot/delete not effected: no provisioned database to snapshot.',
    );
  }

  let store: SnapshotStore;
  try {
    const resolved = resolveSnapshotStore();
    if (!resolved) {
      return recordSnapshotBlocked(
        serviceId,
        'Snapshot/delete not effected: no private snapshot store configured.',
      );
    }
    store = resolved;
  } catch (err) {
    return recordSnapshotBlocked(
      serviceId,
      `Snapshot/delete not effected: ${(err as Error).message}`,
    );
  }

  const dbUri = await resolveLiveDbUri(svc);
  if (!dbUri) {
    return recordSnapshotBlocked(
      serviceId,
      'Snapshot/delete not effected: live database connection is not available to export.',
    );
  }

  // ---- Live ordered pipeline: EXPORT -> encrypt -> upload -> verify STORED ----
  const snapshot = await prisma.dbSnapshot.create({
    data: { backendServiceId: serviceId, status: 'EXPORTING' },
  });
  try {
    const dump = await dumpDatabase(dbUri);
    const encrypted = encryptSnapshot(dump);
    const checksum = sha256(encrypted);
    const key = `snapshots/${serviceId}/${snapshot.id}.enc`;
    const stored = await store.put(key, encrypted);

    // Trust STORED only after the bytes are confirmed present AND intact.
    const intact =
      stored.checksum === checksum &&
      (await store.verify(stored.locationRef, checksum));
    if (!intact) {
      throw new Error('Stored snapshot failed checksum verification.');
    }

    await prisma.dbSnapshot.update({
      where: { id: snapshot.id },
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
      data: { dbLifecycleStatus: 'SNAPSHOTTED', dbDeleteFailureReason: null },
    });
  } catch (err) {
    const reason = `Snapshot export failed: ${(err as Error).message}`;
    await prisma.dbSnapshot.update({
      where: { id: snapshot.id },
      data: { status: 'FAILED', failureReason: reason },
    });
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbDeleteFailureReason: reason },
    });
    logger.warn('Snapshot export failed; DB left intact', { serviceId, reason });
    return { effected: false, reason };
  }

  // ---- STORED & verified => safe to delete the live DB to stop billing -------
  try {
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbLifecycleStatus: 'DELETE_PENDING' },
    });
    const deleted = await deleteService({
      id: svc.railwayDbServiceId,
      environmentId: svc.railwayEnvironmentId ?? undefined,
    });
    if (!deleted) throw new Error('Provider did not confirm database deletion.');
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbLifecycleStatus: 'DELETED' },
    });
    logger.info('Dormant DB snapshotted and deleted', {
      serviceId,
      snapshotId: snapshot.id,
    });
    return { effected: true, reason: 'snapshot STORED and database deleted' };
  } catch (err) {
    // Snapshot is safely STORED; the delete can be retried without data loss.
    const reason = `Snapshot STORED but delete failed (safe to retry): ${(err as Error).message}`;
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbDeleteFailureReason: reason },
    });
    logger.warn('DB delete after snapshot failed', { serviceId, reason });
    return { effected: false, reason };
  }
}

/**
 * Wake a dormant/deleted DB by restoring its latest STORED snapshot. Blocked =>
 * honest RESTORE failure reason, never a fake LIVE. Only marks LIVE after the
 * download is checksum-verified, decrypts, restores, and connects.
 */
export async function restoreSnapshot(serviceId: string): Promise<SeamResult> {
  const svc = await prisma.backendService.findUnique({ where: { id: serviceId } });
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
  if (!snapshot || !snapshot.locationRef || !snapshot.checksum) {
    return recordRestoreBlocked(
      serviceId,
      'Wake unavailable: no STORED snapshot to restore from.',
    );
  }

  const readiness = await getCapabilityReadiness('dormancySnapshotDelete');
  if (!readiness.enabled) {
    return recordRestoreBlocked(
      serviceId,
      `Wake/restore not effected: ${readiness.blockedReason}.`,
    );
  }

  let store: SnapshotStore;
  try {
    const resolved = resolveSnapshotStore();
    if (!resolved) {
      return recordRestoreBlocked(
        serviceId,
        'Wake/restore not effected: no private snapshot store configured.',
      );
    }
    store = resolved;
  } catch (err) {
    return recordRestoreBlocked(
      serviceId,
      `Wake/restore not effected: ${(err as Error).message}`,
    );
  }

  const targetUri = await resolveRestoreTargetUri(svc);
  if (!targetUri) {
    return recordRestoreBlocked(
      serviceId,
      'Wake/restore not effected: no restore target database is available yet.',
    );
  }

  await prisma.backendService.update({
    where: { id: serviceId },
    data: { dbLifecycleStatus: 'RESTORE_PENDING', dbRestoreFailureReason: null },
  });
  try {
    const bytes = await store.get(snapshot.locationRef);
    if (sha256(bytes) !== snapshot.checksum) {
      throw new Error('Downloaded snapshot failed checksum verification.');
    }
    const plain = decryptSnapshot(bytes);
    await restoreDatabase(targetUri, plain);
    await verifyDbConnection(targetUri);
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbLifecycleStatus: 'LIVE', dbRestoreFailureReason: null },
    });
    logger.info('DB restored from snapshot and verified LIVE', {
      serviceId,
      snapshotId: snapshot.id,
    });
    return { effected: true, reason: 'snapshot restored and verified LIVE' };
  } catch (err) {
    const reason = `Restore failed: ${(err as Error).message}`;
    await prisma.backendService.update({
      where: { id: serviceId },
      data: { dbLifecycleStatus: 'RESTORE_FAILED', dbRestoreFailureReason: reason },
    });
    logger.warn('DB restore failed', { serviceId, reason });
    return { effected: false, reason };
  }
}
