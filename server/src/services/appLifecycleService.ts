/**
 * App pause / resume lifecycle (Phase 6) with gated live provider stop/resume.
 *
 * MASTER RULES honored here:
 *   - A backend service is marked PAUSED *only* after a real, verified provider
 *     stop, and ACTIVE again *only* after a real, verified provider start. We
 *     NEVER claim a stop/start that did not happen — instead we record the
 *     INTENT (PAUSE_PENDING / RESUME_PENDING) with an honest failure reason.
 *   - Verified provider stop/resume runs ONLY when the GO-LIVE `provisioning`
 *     capability is enabled. When it is not (switch off / keys missing), pausing
 *     yields PAUSE_PENDING and resuming a truly-paused app yields RESUME_PENDING.
 *   - The IPFS-pinned front-end is NEVER touched. This module only reads/writes
 *     BackendService rows; a user's published site stays online even while their
 *     backend is paused.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import {
  isRailwayConfigured,
  stopDeployment,
  deployServiceInstance,
  getLatestDeploymentStatus,
} from './railway';
import { isCapabilityEnabled } from './goLiveService';

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
  railwayProjectId: string | null;
  railwayBackendServiceId: string | null;
  railwayEnvironmentId: string | null;
  railwayDeploymentId: string | null;
}

const SERVICE_SELECT = {
  id: true,
  status: true,
  railwayProjectId: true,
  railwayBackendServiceId: true,
  railwayEnvironmentId: true,
  railwayDeploymentId: true,
} as const;

/** True only when a real, verified provider stop/start is possible right now. */
async function liveStopResumeEnabled(): Promise<boolean> {
  return isRailwayConfigured() && (await isCapabilityEnabled('provisioning'));
}

async function pauseBackendService(
  bs: ServiceRow,
  reason: string,
  live: boolean,
): Promise<'PAUSED' | 'PAUSE_PENDING'> {
  // Attempt a REAL provider stop only when the live path is enabled and the
  // service is actually provisioned.
  if (live && bs.railwayBackendServiceId && bs.railwayEnvironmentId) {
    try {
      let deploymentId = bs.railwayDeploymentId ?? null;
      if (!deploymentId && bs.railwayProjectId) {
        const dep = await getLatestDeploymentStatus({
          projectId: bs.railwayProjectId,
          serviceId: bs.railwayBackendServiceId,
          environmentId: bs.railwayEnvironmentId,
        });
        deploymentId = dep?.id ?? null;
      }
      if (!deploymentId) {
        throw new Error('No active deployment to stop.');
      }
      const stopped = await stopDeployment(deploymentId);
      if (!stopped) {
        throw new Error('Provider stop did not confirm.');
      }
      await prisma.backendService.update({
        where: { id: bs.id },
        data: {
          status: 'PAUSED',
          pausedAt: new Date(),
          pauseReason: reason,
          pauseFailureReason: null,
          railwayDeploymentId: deploymentId,
        },
      });
      logger.info('Backend verifiably PAUSED on provider', {
        backendServiceId: bs.id,
      });
      return 'PAUSED';
    } catch (err) {
      const failure = (err as Error).message;
      await prisma.backendService.update({
        where: { id: bs.id },
        data: {
          status: 'PAUSE_PENDING',
          pausedAt: null,
          pauseReason: reason,
          pauseFailureReason: `Stop not effected: ${failure}`,
        },
      });
      logger.warn('Backend pause recorded PAUSE_PENDING (stop not effected)', {
        backendServiceId: bs.id,
        failure,
      });
      return 'PAUSE_PENDING';
    }
  }

  // Inert / not-provisioned path — record intent honestly, never fake PAUSED.
  let failure: string;
  if (!live) {
    failure =
      'Backend pause/resume is not live yet (GO-LIVE provisioning off or keys missing).';
  } else if (!bs.railwayBackendServiceId || !bs.railwayEnvironmentId) {
    failure = 'No provisioned Railway service to stop.';
  } else {
    failure = 'Backend is not in a stoppable state.';
  }
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
export async function pauseUserApps(
  userId: string,
  reason: string,
): Promise<PauseResult> {
  const services = await prisma.backendService.findMany({
    where: { project: { userId }, status: 'ACTIVE' },
    select: SERVICE_SELECT,
  });
  const live = await liveStopResumeEnabled();
  let paused = 0;
  let pendingPause = 0;
  for (const bs of services) {
    const outcome = await pauseBackendService(bs, reason, live);
    if (outcome === 'PAUSED') paused += 1;
    else pendingPause += 1;
  }
  return { attempted: services.length, paused, pendingPause };
}

async function resumeBackendService(
  bs: ServiceRow,
  live: boolean,
): Promise<'ACTIVE' | 'RESUME_PENDING'> {
  // A PAUSE_PENDING service was never actually stopped, so clearing the pause
  // intent fully resumes it (no provider start needed).
  if (bs.status === 'PAUSE_PENDING') {
    await prisma.backendService.update({
      where: { id: bs.id },
      data: {
        status: 'ACTIVE',
        pausedAt: null,
        pauseReason: null,
        pauseFailureReason: null,
      },
    });
    return 'ACTIVE';
  }

  // A truly PAUSED service needs a verified provider start (a redeploy).
  if (live && bs.railwayBackendServiceId && bs.railwayEnvironmentId) {
    try {
      const ok = await deployServiceInstance({
        serviceId: bs.railwayBackendServiceId,
        environmentId: bs.railwayEnvironmentId,
      });
      if (!ok) {
        throw new Error('Provider start did not confirm.');
      }
      await prisma.backendService.update({
        where: { id: bs.id },
        data: {
          status: 'ACTIVE',
          pausedAt: null,
          pauseReason: null,
          pauseFailureReason: null,
        },
      });
      logger.info('Backend verifiably resumed on provider', {
        backendServiceId: bs.id,
      });
      return 'ACTIVE';
    } catch (err) {
      const failure = (err as Error).message;
      await prisma.backendService.update({
        where: { id: bs.id },
        data: {
          status: 'RESUME_PENDING',
          pauseFailureReason: `Start not effected: ${failure}`,
        },
      });
      logger.warn('Backend resume recorded RESUME_PENDING (start not effected)', {
        backendServiceId: bs.id,
        failure,
      });
      return 'RESUME_PENDING';
    }
  }

  await prisma.backendService.update({
    where: { id: bs.id },
    data: {
      status: 'RESUME_PENDING',
      pauseFailureReason:
        'Verified provider start is not live yet (GO-LIVE off or keys missing).',
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
    select: SERVICE_SELECT,
  });
  const live = await liveStopResumeEnabled();
  let resumed = 0;
  let pendingResume = 0;
  for (const bs of services) {
    const outcome = await resumeBackendService(bs, live);
    if (outcome === 'ACTIVE') resumed += 1;
    else pendingResume += 1;
  }
  return { attempted: services.length, resumed, pendingResume };
}
