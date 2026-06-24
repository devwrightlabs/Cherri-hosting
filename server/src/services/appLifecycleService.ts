/**
 * App pause / resume lifecycle (Phase 6).
 *
 * MASTER RULES honored here:
 *   - A backend service is marked PAUSED *only* after a real, verified provider
 *     stop. We NEVER claim a stop that did not happen (no provider configured,
 *     no provisioned service, or unverified stop/resume semantics) — instead we
 *     record the INTENT (PAUSE_PENDING) with an honest failure reason.
 *   - The IPFS-pinned front-end is NEVER touched. This module only ever reads /
 *     writes BackendService rows; it must never modify Deployment rows, so a
 *     user's published site stays online even while their backend is paused.
 *
 * Live Railway provisioning (Phase 2) is not enabled and a verified stop/resume
 * path for a backend service is not yet wired (Railway's deploymentStop targets
 * a deployment id and is not a verified inverse of a resume/start). Until that
 * is built, pausing only ever yields PAUSE_PENDING.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { isRailwayConfigured } from './railway';

export interface PauseResult {
  /** Backend services considered. */
  attempted: number;
  /** Verifiably stopped on the provider. */
  paused: number;
  /** Pause intent recorded but the stop was not effected. */
  pendingPause: number;
}

export interface ResumeResult {
  attempted: number;
  resumed: number;
  pendingResume: number;
}

interface ServiceRow {
  id: string;
  status: string;
  railwayBackendServiceId: string | null;
  railwayEnvironmentId: string | null;
}

async function pauseBackendService(
  bs: ServiceRow,
  reason: string,
): Promise<'PAUSED' | 'PAUSE_PENDING'> {
  let failure: string;
  if (!isRailwayConfigured()) {
    failure = 'Railway is not configured; cannot stop a live backend.';
  } else if (!bs.railwayBackendServiceId || !bs.railwayEnvironmentId) {
    failure = 'No provisioned Railway service to stop.';
  } else {
    failure = 'Verified Railway stop/resume is not yet enabled (deferred to live provisioning).';
  }
  // No real stop is possible/verified today -> record intent, never fake PAUSED.
  await prisma.backendService.update({
    where: { id: bs.id },
    data: {
      status: 'PAUSE_PENDING',
      pausedAt: null,
      pauseReason: reason,
      pauseFailureReason: failure,
    },
  });
  logger.info('Backend pause recorded as PAUSE_PENDING (stop not effected)', {
    backendServiceId: bs.id,
    failure,
  });
  return 'PAUSE_PENDING';
}

/** Pause every ACTIVE backend service owned by the user. Never touches IPFS. */
export async function pauseUserApps(userId: string, reason: string): Promise<PauseResult> {
  const services = await prisma.backendService.findMany({
    where: { project: { userId }, status: 'ACTIVE' },
    select: {
      id: true,
      status: true,
      railwayBackendServiceId: true,
      railwayEnvironmentId: true,
    },
  });
  let paused = 0;
  let pendingPause = 0;
  for (const bs of services) {
    const outcome = await pauseBackendService(bs, reason);
    if (outcome === 'PAUSED') paused += 1;
    else pendingPause += 1;
  }
  return { attempted: services.length, paused, pendingPause };
}

async function resumeBackendService(bs: ServiceRow): Promise<'ACTIVE' | 'RESUME_PENDING'> {
  // A PAUSE_PENDING service was never actually stopped, so resuming simply
  // clears the pause intent. A truly PAUSED service needs a verified provider
  // start (deferred), so it is left RESUME_PENDING until that real start runs.
  if (bs.status === 'PAUSE_PENDING') {
    await prisma.backendService.update({
      where: { id: bs.id },
      data: { status: 'ACTIVE', pausedAt: null, pauseReason: null, pauseFailureReason: null },
    });
    return 'ACTIVE';
  }
  await prisma.backendService.update({
    where: { id: bs.id },
    data: {
      status: 'RESUME_PENDING',
      pauseFailureReason:
        'Verified provider start is not yet enabled (deferred to live provisioning).',
    },
  });
  return 'RESUME_PENDING';
}

/** Resume the user's paused backend services on settlement. Never touches IPFS. */
export async function resumeUserApps(userId: string): Promise<ResumeResult> {
  const services = await prisma.backendService.findMany({
    where: {
      project: { userId },
      status: { in: ['PAUSE_PENDING', 'PAUSED', 'RESUME_PENDING'] },
    },
    select: {
      id: true,
      status: true,
      railwayBackendServiceId: true,
      railwayEnvironmentId: true,
    },
  });
  let resumed = 0;
  let pendingResume = 0;
  for (const bs of services) {
    const outcome = await resumeBackendService(bs);
    if (outcome === 'ACTIVE') resumed += 1;
    else pendingResume += 1;
  }
  return { attempted: services.length, resumed, pendingResume };
}
