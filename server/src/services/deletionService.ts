/**
 * Phase 10 app deletion — real teardown, never a fake removal.
 *
 * Deleting an app must actually stop costing the operator AND must never claim a
 * resource is gone when it still exists. So this orchestrates a confirmed
 * teardown and only hard-deletes the rows once every real resource is gone:
 *
 *   1. mark Project DELETING
 *   2. unpin every IPFS pin (Pinata) — the inverse of deploy; gated only on
 *      Pinata being configured (pinning works today, so unpinning must too)
 *   3. tear down the Railway backend (service + DB) — gated on the providerTeardown
 *      capability; until enabled, backend resources are left intact and deletion
 *      stays DELETING rather than lying that the backend is gone
 *   4. purge app-owned PRIVATE encrypted artifacts (backups + snapshots) from the
 *      store
 *   5. only when ALL of the above are confirmed → hard-delete the rows (DELETED)
 *
 * If any real resource can't be confirmed gone (provider unreachable, capability
 * off, store unavailable) we keep the rows, stay DELETING, and record an honest
 * deletionFailureReason for a later retry. An app with NO backend resources is a
 * full real delete today (unpin + remove rows).
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { unpin } from './ipfs';
import { deleteProject as railwayDeleteProject, deleteService } from './railway';
import { resolveSnapshotStore } from './snapshotStore';
import { isPinataConfigured } from '../utils/integrations';
import { isCapabilityEnabled } from './goLiveService';

export class DeletionError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DeletionError';
    this.status = status;
  }
}

// Test seams: let unit tests inject fakes so deletion ordering can be verified
// without touching the real Pinata/Railway networks. Default to the real clients.
let unpinFn: (cid: string) => Promise<void> = unpin;
export function __setUnpinFn(fn: ((cid: string) => Promise<void>) | null): void {
  unpinFn = fn ?? unpin;
}

interface RailwayTeardownFns {
  deleteProject: typeof railwayDeleteProject;
  deleteService: typeof deleteService;
}
const realRailwayFns: RailwayTeardownFns = {
  deleteProject: railwayDeleteProject,
  deleteService,
};
let railwayFns: RailwayTeardownFns = realRailwayFns;
export function __setRailwayTeardownFns(fns: Partial<RailwayTeardownFns> | null): void {
  railwayFns = fns ? { ...realRailwayFns, ...fns } : realRailwayFns;
}

export interface DeletionResult {
  /** DELETED = rows removed after confirmed teardown; DELETING = real resources
   *  remain, retained for retry with an honest reason. */
  status: 'DELETED' | 'DELETING';
  reason?: string;
}

/** A pin that is already absent isn't a failure — treat 4xx "not pinned" as gone. */
function isAlreadyUnpinned(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return status === 404 || status === 400;
}

/**
 * Fully delete a project: confirmed teardown first, rows last. Throws
 * DeletionError(404) when the project isn't the caller's. Never fakes removal.
 */
export async function deleteProjectFully(
  projectId: string,
  userId: string,
): Promise<DeletionResult> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      deployments: { select: { cid: true } },
      backendService: {
        include: {
          backups: { select: { locationRef: true } },
          snapshots: { select: { locationRef: true } },
        },
      },
    },
  });
  if (!project) {
    throw new DeletionError(404, 'Project not found.');
  }

  // Enter/continue the DELETING state, clearing any prior failure reason.
  await prisma.project.update({
    where: { id: projectId },
    data: { lifecycleStatus: 'DELETING', deletionFailureReason: null },
  });

  // Accumulate honest, non-leaky reasons for anything we couldn't confirm gone.
  const failures: string[] = [];

  // 1) Unpin every unique CID from IPFS. These are real provider resources; if we
  //    can't remove them we must not pretend the app is gone.
  const cids = [
    ...new Set(project.deployments.map((d) => d.cid).filter((c) => c && c.length > 0)),
  ];
  if (cids.length > 0) {
    if (!isPinataConfigured()) {
      failures.push('IPFS pins still exist but IPFS is not configured to remove them.');
    } else {
      for (const cid of cids) {
        try {
          await unpinFn(cid);
        } catch (err) {
          if (isAlreadyUnpinned(err)) continue;
          failures.push('One or more IPFS pins could not be removed.');
          logger.warn('Deletion: unpin failed', { projectId });
        }
      }
    }
  }

  // 2) Tear down the Railway backend (service + DB) — gated on providerTeardown.
  const svc = project.backendService;
  const hasRailwayResources =
    !!svc &&
    !!(svc.railwayProjectId || svc.railwayBackendServiceId || svc.railwayDbServiceId);
  if (hasRailwayResources) {
    if (!(await isCapabilityEnabled('providerTeardown'))) {
      failures.push('Backend resources still exist; provider teardown is not enabled yet.');
    } else {
      try {
        // Deleting the whole Railway project removes both the backend service and
        // its database in one call; fall back to per-service deletes otherwise.
        // A mutation that returns `false` is NOT a confirmed teardown — treat it
        // exactly like a thrown error so we never claim a resource is gone.
        if (svc!.railwayProjectId) {
          const ok = await railwayFns.deleteProject(svc!.railwayProjectId);
          if (!ok) throw new Error('Provider did not confirm project deletion.');
        } else {
          if (svc!.railwayBackendServiceId) {
            const ok = await railwayFns.deleteService({
              id: svc!.railwayBackendServiceId,
              environmentId: svc!.railwayEnvironmentId ?? undefined,
            });
            if (!ok) throw new Error('Provider did not confirm backend service deletion.');
          }
          if (svc!.railwayDbServiceId) {
            const ok = await railwayFns.deleteService({
              id: svc!.railwayDbServiceId,
              environmentId: svc!.railwayEnvironmentId ?? undefined,
            });
            if (!ok) throw new Error('Provider did not confirm database deletion.');
          }
        }
      } catch (err) {
        failures.push('Backend resources could not be torn down.');
        logger.warn('Deletion: Railway teardown failed', { projectId });
      }
    }
  }

  // 3) Purge app-owned PRIVATE encrypted artifacts (backups + snapshots).
  const artifactRefs = [
    ...(svc?.backups ?? []),
    ...(svc?.snapshots ?? []),
  ]
    .map((a) => a.locationRef)
    .filter((ref): ref is string => !!ref);
  if (artifactRefs.length > 0) {
    let store = null;
    try {
      store = resolveSnapshotStore();
    } catch {
      failures.push('Stored backups/snapshots remain; the private store is misconfigured.');
    }
    if (store) {
      for (const ref of artifactRefs) {
        try {
          await store.remove(ref);
        } catch {
          failures.push('One or more stored backups/snapshots could not be purged.');
          logger.warn('Deletion: store purge failed', { projectId });
        }
      }
    } else if (!failures.some((f) => f.includes('private store'))) {
      failures.push('Stored backups/snapshots remain; no private store is configured to purge them.');
    }
  }

  // If any real resource remains, stay DELETING and record why. NEVER fake removal.
  if (failures.length > 0) {
    const reason = failures.join(' ');
    await prisma.project.update({
      where: { id: projectId },
      data: { lifecycleStatus: 'DELETING', deletionFailureReason: reason },
    });
    logger.warn('Project deletion incomplete; staying DELETING', {
      projectId,
      failureCount: failures.length,
    });
    return { status: 'DELETING', reason };
  }

  // Everything confirmed gone → hard-delete the rows. Deployments have no cascade
  // so they go first; deleting the Project cascades BackendService -> backups,
  // snapshots, and usage samples.
  await prisma.$transaction(async (tx) => {
    await tx.deployment.deleteMany({ where: { projectId } });
    await tx.project.delete({ where: { id: projectId } });
  });
  logger.info('Project fully deleted', { projectId });
  return { status: 'DELETED' };
}
