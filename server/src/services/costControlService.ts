/**
 * Phase 7 cost-control core: the operator's singleton config, the hard cap on
 * simultaneously-live databases (the PRIMARY cost defense while Railway lacks a
 * native snapshot/restore), and operator cost alerts.
 *
 * Honesty: a "live DB" is one that is actually provisioned on Railway and still
 * billing. While provisioning is deferred there are zero of them, so the cap
 * reports a truthful 0 — it is never faked.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

export const COST_CONFIG_ID = 'singleton';

/** Statuses where a provisioned DB is NOT billing anymore (excluded from cap). */
const NOT_BILLING_STATUSES = ['SNAPSHOTTED', 'DELETED'];

export class CostControlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CostControlValidationError';
  }
}

export class LiveDbCapReachedError extends Error {
  readonly current: number;
  readonly max: number;
  constructor(current: number, max: number) {
    super(
      `Live database cap reached (${current}/${max}). New databases are blocked to cap cost exposure.`,
    );
    this.name = 'LiveDbCapReachedError';
    this.current = current;
    this.max = max;
  }
}

/** Fetch the singleton config, creating it with defaults on first access. */
export async function getCostControlConfig() {
  return prisma.operatorCostControlConfig.upsert({
    where: { id: COST_CONFIG_ID },
    update: {},
    create: { id: COST_CONFIG_ID },
  });
}

export interface CostControlConfigPatch {
  maxLiveDbs?: number;
  warnAtPercent?: number;
  inactivityDays?: number;
  snapshotDeleteEnabled?: boolean;
}

export async function updateCostControlConfig(patch: CostControlConfigPatch) {
  const data: Prisma.OperatorCostControlConfigUpdateInput = {};

  if (patch.maxLiveDbs !== undefined) {
    if (!Number.isInteger(patch.maxLiveDbs) || patch.maxLiveDbs < 1) {
      throw new CostControlValidationError('maxLiveDbs must be an integer >= 1');
    }
    data.maxLiveDbs = patch.maxLiveDbs;
  }
  if (patch.warnAtPercent !== undefined) {
    if (
      !Number.isInteger(patch.warnAtPercent) ||
      patch.warnAtPercent < 1 ||
      patch.warnAtPercent > 100
    ) {
      throw new CostControlValidationError(
        'warnAtPercent must be an integer between 1 and 100',
      );
    }
    data.warnAtPercent = patch.warnAtPercent;
  }
  if (patch.inactivityDays !== undefined) {
    if (!Number.isInteger(patch.inactivityDays) || patch.inactivityDays < 1) {
      throw new CostControlValidationError(
        'inactivityDays must be an integer >= 1',
      );
    }
    data.inactivityDays = patch.inactivityDays;
  }
  if (patch.snapshotDeleteEnabled !== undefined) {
    data.snapshotDeleteEnabled = Boolean(patch.snapshotDeleteEnabled);
  }

  await getCostControlConfig(); // ensure the row exists
  return prisma.operatorCostControlConfig.update({
    where: { id: COST_CONFIG_ID },
    data,
  });
}

/** Count databases that are actually provisioned on Railway and still billing. */
export async function countLiveDbs(): Promise<number> {
  return prisma.backendService.count({
    where: {
      railwayDbServiceId: { not: null },
      dbLifecycleStatus: { notIn: NOT_BILLING_STATUSES },
    },
  });
}

export interface CapStatus {
  current: number;
  max: number;
  percent: number;
  atWarn: boolean;
  atCap: boolean;
  warnAtPercent: number;
}

export async function getCapStatus(): Promise<CapStatus> {
  const config = await getCostControlConfig();
  const current = await countLiveDbs();
  const max = config.maxLiveDbs;
  const percent = max > 0 ? Math.round((current / max) * 100) : 100;
  return {
    current,
    max,
    percent,
    atWarn: percent >= config.warnAtPercent,
    atCap: current >= max,
    warnAtPercent: config.warnAtPercent,
  };
}

/**
 * Provision-time guard. Call this BEFORE creating a new live Railway database.
 * Throws LiveDbCapReachedError when the cap is hit (blocking the new DB), and
 * raises an operator alert when at/over the warn threshold. (Provisioning is
 * deferred, so nothing calls this live yet — it is the ready, honest seam.)
 *
 * ATOMICITY CONTRACT: this is a read-before-create check and is NOT concurrency-
 * safe on its own. When live provisioning is wired, it MUST be invoked inside
 * the same DB transaction / advisory lock (or a serialized provisioning queue)
 * that creates the BackendService row, immediately before DB creation — else
 * concurrent requests could both pass and exceed the cap.
 */
export async function assertCapAllowsNewDb(): Promise<void> {
  const status = await getCapStatus();
  if (status.atCap) {
    await emitCapAlert('CAP_REACHED', status);
    throw new LiveDbCapReachedError(status.current, status.max);
  }
  if (status.atWarn) {
    await emitCapAlert('CAP_WARNING', status);
  }
}

/**
 * Advisory-lock key that serializes all live-DB provisioning so two concurrent
 * provisions can never both slip under the cap. Arbitrary stable constant.
 */
export const PROVISION_LOCK_KEY = 947211;

/** In-flight provision statuses that have reserved a cap slot. */
const RESERVING_STATUSES = ['PROVISIONING'];

/**
 * Count rows occupying a live-DB cap slot: a provisioned-and-still-billing DB OR
 * an in-flight provision about to create one. Distinct rows (a row matching both
 * conditions is counted once).
 */
export async function countCapSlots(
  client: Prisma.TransactionClient = prisma as unknown as Prisma.TransactionClient,
): Promise<number> {
  return client.backendService.count({
    where: {
      OR: [
        {
          railwayDbServiceId: { not: null },
          dbLifecycleStatus: { notIn: NOT_BILLING_STATUSES },
        },
        { status: { in: RESERVING_STATUSES } },
      ],
    },
  });
}

export interface ReserveResult {
  ok: boolean;
  backendServiceId?: string;
  reason?: string;
  status: CapStatus;
}

/**
 * Atomically reserve a live-DB cap slot AND create the PROVISIONING
 * BackendService row, under a Postgres advisory lock. This is the concurrency-
 * safe live-path replacement for assertCapAllowsNewDb: the cap check and the
 * slot-reserving row insert commit together, so two concurrent provisions can
 * never both pass the cap. The slow provider work runs AFTER this returns,
 * outside the (short) transaction. Returns ok:false (no row created) at the cap.
 */
export async function reserveProvisioningSlot(
  projectId: string,
): Promise<ReserveResult> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PROVISION_LOCK_KEY})`;
    const config = await tx.operatorCostControlConfig.upsert({
      where: { id: COST_CONFIG_ID },
      update: {},
      create: { id: COST_CONFIG_ID },
    });
    const current = await countCapSlots(tx);
    const max = config.maxLiveDbs;
    const mkStatus = (n: number): CapStatus => {
      const percent = max > 0 ? Math.round((n / max) * 100) : 100;
      return {
        current: n,
        max,
        percent,
        atWarn: percent >= config.warnAtPercent,
        atCap: n >= max,
        warnAtPercent: config.warnAtPercent,
      };
    };
    if (current >= max) {
      return {
        ok: false as const,
        reason: `Live database cap reached (${current}/${max}). New backends are blocked to cap cost exposure.`,
        status: mkStatus(current),
      };
    }
    const bs = await tx.backendService.create({
      data: { projectId, status: 'PROVISIONING' },
    });
    return {
      ok: true as const,
      backendServiceId: bs.id,
      status: mkStatus(current + 1),
    };
  });
  // Alerts are best-effort and emitted outside the lock transaction.
  if (!result.ok) {
    await emitCapAlert('CAP_REACHED', result.status);
  } else if (result.status.atWarn) {
    await emitCapAlert('CAP_WARNING', result.status);
  }
  return result;
}

async function emitCapAlert(
  type: 'CAP_WARNING' | 'CAP_REACHED',
  status: CapStatus,
): Promise<void> {
  // Dedup by (type, current/max) so a given crossing alerts at most once.
  const dedupeKey = `${type}:${status.current}/${status.max}`;
  const message =
    type === 'CAP_REACHED'
      ? `Live database cap reached: ${status.current}/${status.max}. New databases are blocked.`
      : `Approaching live database cap: ${status.current}/${status.max} (${status.percent}%).`;
  try {
    await prisma.operatorAlert.create({
      data: { type, message, context: JSON.stringify(status), dedupeKey },
    });
    logger.warn('Operator cost alert raised', { type, dedupeKey });
  } catch (err) {
    // Unique violation => already alerted for this exact crossing; ignore.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return;
    }
    throw err;
  }
}

export async function listOperatorAlerts() {
  return prisma.operatorAlert.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function markAllOperatorAlertsRead(): Promise<number> {
  const result = await prisma.operatorAlert.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
