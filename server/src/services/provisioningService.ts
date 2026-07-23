/**
 * Phase 2 live provisioning orchestration (gated).
 *
 * MASTER RULES honored here:
 *   - Provisioning runs ONLY when the GO-LIVE `provisioning` capability is
 *     enabled (master switch on + Railway token + paid attestation + a backend
 *     template). When it is not, provisionBackend() returns BLOCKED and creates
 *     NOTHING — no Railway calls, no DB row. The caller degrades honestly (503).
 *   - A backend is marked ACTIVE *only* after a real deploy is verified SUCCESS
 *     and a public URL exists. We NEVER fake an ACTIVE backend; a partial
 *     provision is recorded FAILED with the real error and torn down so it does
 *     not keep billing.
 *   - The live-DB cap is enforced atomically (advisory-locked reservation) so
 *     concurrent provisions can never both slip under the cap.
 *   - The provider (Railway) domain is operator-only. The only URL ever exposed
 *     to an end user / injected into the public IPFS bundle is a branded,
 *     non-provider domain — see resolveCustomerBackendUrl().
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import {
  goLiveReadiness,
  isCapabilityEnabled,
  type CapabilityReadiness,
} from './goLiveService';
import { reserveProvisioningSlot } from './costControlService';
import {
  listProjects,
  getProject,
  createProject,
  createService,
  provisionPostgres,
  upsertVariable,
  deployServiceInstance,
  createServiceDomain,
  getLatestDeploymentStatus,
  deleteProject,
  RailwayApiError,
  type RailwayDeploymentStatus,
} from './railway';

/**
 * Test seam — the resumable workflow calls every Railway operation through this
 * indirection so tests can simulate outages, adoption, and deploy states without
 * touching the live provider. Production uses the real functions unchanged.
 */
interface ProvisioningRailwayFns {
  listProjects: typeof listProjects;
  getProject: typeof getProject;
  createProject: typeof createProject;
  createService: typeof createService;
  provisionPostgres: typeof provisionPostgres;
  upsertVariable: typeof upsertVariable;
  deployServiceInstance: typeof deployServiceInstance;
  createServiceDomain: typeof createServiceDomain;
  getLatestDeploymentStatus: typeof getLatestDeploymentStatus;
  deleteProject: typeof deleteProject;
}
const realRailwayFns: ProvisioningRailwayFns = {
  listProjects,
  getProject,
  createProject,
  createService,
  provisionPostgres,
  upsertVariable,
  deployServiceInstance,
  createServiceDomain,
  getLatestDeploymentStatus,
  deleteProject,
};
let railwayFns: ProvisioningRailwayFns = realRailwayFns;
export function __setProvisioningRailwayFns(
  fns: Partial<ProvisioningRailwayFns> | null,
): void {
  railwayFns = fns ? { ...realRailwayFns, ...fns } : realRailwayFns;
}

export type ProvisionOutcome =
  | 'PROVISIONED'
  | 'EXISTS'
  | 'BLOCKED'
  | 'CAP_REACHED'
  | 'FAILED'
  /** Provider (Railway) outage/timeout, or a deploy not yet verified. The row
   *  stays PROVISIONING with a scheduled retry — NEVER marked FAILED, NEVER torn
   *  down — so it self-heals when the provider returns / the build finishes. */
  | 'DEFERRED';

export interface ProvisionResult {
  outcome: ProvisionOutcome;
  backendServiceId?: string;
  /** Verified provider URL — OPERATOR-ONLY. Never return this to an end user. */
  publicUrl?: string;
  /** Operator-facing honest reason; NEVER returned verbatim to end users. */
  reason?: string;
  capability?: CapabilityReadiness;
}

const templateRepo = (): string | undefined =>
  process.env.RAILWAY_BACKEND_TEMPLATE_REPO?.trim() || undefined;
const templateBranch = (): string | undefined =>
  process.env.RAILWAY_BACKEND_TEMPLATE_BRANCH?.trim() || undefined;
const templateImage = (): string | undefined =>
  process.env.RAILWAY_BACKEND_IMAGE?.trim() || undefined;

/** Name of the Postgres service created per app (used for the var reference). */
const PG_SERVICE_NAME = 'postgres';
/** Name of the backend service created per app (used for adoption-by-name). */
const BACKEND_SERVICE_NAME = 'backend';

/**
 * Deterministic per-app Railway project name. Using a name derived ONLY from the
 * projectId (no timestamp) is what makes provisioning resumable across a provider
 * outage: if a `createProject` call timed out but actually created the project, a
 * later retry finds it by this exact name and ADOPTS it instead of creating a
 * second billable project. One Cherri app => at most one Railway project, ever.
 */
function deterministicProjectName(projectId: string): string {
  return `cherri-app-${projectId}`;
}

// Capped exponential backoff for outage/deploy-pending retries. The retry
// reconciler will not re-drive a row before provisioningNextRetryAt.
const RETRY_BASE_MS = 60_000; // 1 min
const RETRY_CAP_MS = 30 * 60_000; // 30 min
function computeBackoffMs(attemptCount: number): number {
  const exp = Math.min(Math.max(attemptCount, 0), 10);
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** exp);
}

/** Deploy statuses that are a real, terminal FAILURE (never retried). */
const TERMINAL_DEPLOY_FAILURE: readonly RailwayDeploymentStatus[] = [
  'FAILED',
  'CRASHED',
  'REMOVED',
];

/** Sanitize a thrown error into an honest, operator-facing reason string. */
function reasonFromError(err: unknown): string {
  if (err instanceof RailwayApiError) {
    return err.isOutage
      ? 'Provider outage/timeout during provisioning.'
      : err.message;
  }
  return (err as Error)?.message ?? 'Unknown provisioning error.';
}

/**
 * Keep a provisioning row retryable after a provider outage OR a not-yet-verified
 * deploy: status stays PROVISIONING, a backoff retry is scheduled, and an honest
 * (sanitized) reason is recorded. NEVER marks FAILED and NEVER tears down — the
 * resources (if any) may be fine, so we must not destroy them or stop billing
 * blindly. Returns a DEFERRED result.
 */
async function deferProvisioning(
  backendServiceId: string,
  currentAttemptCount: number,
  reason: string,
): Promise<ProvisionResult> {
  const attemptCount = currentAttemptCount + 1;
  const nextRetryAt = new Date(Date.now() + computeBackoffMs(attemptCount));
  await prisma.backendService
    .update({
      where: { id: backendServiceId },
      data: {
        status: 'PROVISIONING',
        provisioningAttemptCount: attemptCount,
        provisioningNextRetryAt: nextRetryAt,
        failureReason: reason,
      },
    })
    .catch((dbErr: unknown) => {
      // Log (not swallow) — the retry loop can still pick the row up, but a
      // silent failure here would hide why attempt counts/backoff didn't move.
      logger.error('Failed to record deferred provisioning state', {
        backendServiceId,
        error: (dbErr as Error)?.message ?? String(dbErr),
      });
    });
  logger.warn('Provisioning deferred; will retry', {
    backendServiceId,
    attemptCount,
    nextRetryAt: nextRetryAt.toISOString(),
    reason,
  });
  return { outcome: 'DEFERRED', backendServiceId, reason };
}

/**
 * The ONLY backend URL we will ever expose to an end user or inject into the
 * public IPFS bundle. The raw provider (Railway) domain is operator-only and
 * MUST NEVER leak, so a `*.railway.app` host returns null — a branded custom
 * domain (operator-configured) is required before a customer-facing URL exists.
 */
export function resolveCustomerBackendUrl(
  publicUrl: string | null | undefined,
): string | null {
  if (!publicUrl) return null;
  let host: string;
  try {
    host = new URL(publicUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === 'railway.app' || host.endsWith('.railway.app')) return null;
  return publicUrl;
}

/**
 * The branded backend URL to inject into a project's front-end bundle, or null.
 * Returns a URL ONLY when ALL hold: the GO-LIVE envWiring capability is enabled,
 * the project has an ACTIVE backend with a verified public URL, AND that URL is
 * a branded (non-provider) domain. Otherwise null — env wiring is a no-op and
 * the bundle ships with no backend config (honest: never injects a provider URL
 * or a backend that isn't verified-active).
 */
export async function resolveInjectableBackendUrlForProject(
  projectId: string,
): Promise<string | null> {
  if (!(await isCapabilityEnabled('envWiring'))) return null;
  const bs = await prisma.backendService.findUnique({
    where: { projectId },
    select: { status: true, publicUrl: true },
  });
  if (!bs || bs.status !== 'ACTIVE') return null;
  return resolveCustomerBackendUrl(bs.publicUrl);
}

/**
 * Phase 9 — per-app DB credential isolation guard. The value wired into a user
 * backend's DATABASE_URL MUST be a Railway variable reference to THAT app's own
 * Postgres service — never a literal connection string and never Cherri's own
 * master DATABASE_URL. Each app's Postgres lives in its own Railway project with
 * its own credentials, so one app can never reach another app's (or our)
 * database. This guard makes a wrong value impossible to inject even if a future
 * code change passed one by mistake.
 */
export function assertPerAppDbIsolation(name: string, value: string): void {
  if (name !== 'DATABASE_URL') return;
  const v = value.trim();
  const cherri = process.env.DATABASE_URL?.trim();
  if (cherri && v === cherri) {
    throw new Error("Refusing to inject Cherri's master DATABASE_URL into a user backend.");
  }
  if (!/^\$\{\{[^}]+\.DATABASE_URL\}\}$/.test(v)) {
    throw new Error(
      "Per-app DATABASE_URL must be a Railway variable reference to the app's own Postgres, not a literal connection string.",
    );
  }
}

/**
 * Provision a backend (service + Postgres) for a project. Idempotent per
 * project. See module doc for the honesty guarantees. Returns a discriminated
 * result; the HTTP route maps it to an honest status (never leaks provider ids).
 *
 * This is the USER-INITIATED entry. It gates on the GO-LIVE capability, enforces
 * the live-DB cap, reserves the PROVISIONING row, then hands off to the resumable
 * workflow. A provider outage during the workflow returns DEFERRED (retryable) —
 * the retry reconciler later re-drives it via {@link resumeProvisioning}.
 */
export async function provisionBackend(
  projectId: string,
): Promise<ProvisionResult> {
  const readiness = await goLiveReadiness();
  const cap = readiness.capabilities.provisioning;
  if (!cap.enabled) {
    return {
      outcome: 'BLOCKED',
      reason: cap.blockedReason ?? 'Provisioning is not enabled.',
      capability: cap,
    };
  }

  // Idempotency: at most one backend per project.
  const existing = await prisma.backendService.findUnique({
    where: { projectId },
  });
  if (existing) {
    if (existing.status === 'ACTIVE') {
      return {
        outcome: 'EXISTS',
        backendServiceId: existing.id,
        publicUrl: existing.publicUrl ?? undefined,
      };
    }
    if (existing.status === 'PROVISIONING') {
      // Already in flight (possibly mid-retry after an outage). The retry
      // reconciler owns re-driving it — don't start a second concurrent driver.
      // This is PENDING, NEVER active: returning DEFERRED keeps the route honest
      // (a still-provisioning backend must never be reported as 'active').
      return {
        outcome: 'DEFERRED',
        backendServiceId: existing.id,
        reason: 'Provisioning is already in progress for this project.',
      };
    }
    // A stale FAILED/DELETED row — clear it so a fresh attempt can reserve.
    await prisma.backendService
      .delete({ where: { id: existing.id } })
      .catch(() => undefined);
  }

  // Atomically reserve a live-DB cap slot AND create the PROVISIONING row.
  let backendServiceId: string;
  try {
    const reservation = await reserveProvisioningSlot(projectId);
    if (!reservation.ok) {
      return { outcome: 'CAP_REACHED', reason: reservation.reason };
    }
    backendServiceId = reservation.backendServiceId!;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return {
        outcome: 'EXISTS',
        reason: 'A backend already exists for this project.',
      };
    }
    throw err;
  }

  return runProvisioningWorkflow(backendServiceId);
}

/**
 * Re-drive a PROVISIONING row that was deferred by a provider outage or an
 * in-progress deploy. Called ONLY by the retry reconciler (which gates on the
 * backend lane being live + the provider being reachable). Safe to call on any
 * row: it no-ops (EXISTS) when the row is already ACTIVE/terminal or gone.
 */
export async function resumeProvisioning(
  backendServiceId: string,
): Promise<ProvisionResult> {
  const bs = await prisma.backendService.findUnique({
    where: { id: backendServiceId },
    select: { status: true },
  });
  if (!bs) {
    return { outcome: 'FAILED', reason: 'Backend service row no longer exists.' };
  }
  if (bs.status !== 'PROVISIONING') {
    return { outcome: 'EXISTS', backendServiceId };
  }
  return runProvisioningWorkflow(backendServiceId);
}

/**
 * The resumable provisioning state machine. Reads the row's current Railway ids
 * and continues ONLY the steps not yet done, adopting any orphaned Railway
 * resources (project + services) by deterministic name so a timed-out call can
 * never produce a duplicate billable project. Honesty guarantees:
 *   - A provider OUTAGE (RailwayApiError.isOutage) at ANY step => DEFERRED:
 *     status stays PROVISIONING, a retry is scheduled, NOTHING is torn down.
 *   - A deploy that is not yet SUCCESS but not terminally failed => DEFERRED too
 *     (the build may still finish) — never marked ACTIVE, never marked FAILED.
 *   - A terminal deploy failure or any non-outage error => FAILED + best-effort
 *     teardown (existing behavior) so a broken partial provision stops billing.
 *   - ACTIVE is set ONLY after a verified SUCCESS deploy.
 */
async function runProvisioningWorkflow(
  backendServiceId: string,
): Promise<ProvisionResult> {
  const bs = await prisma.backendService.findUnique({
    where: { id: backendServiceId },
  });
  if (!bs) {
    return { outcome: 'FAILED', reason: 'Backend service row vanished.' };
  }
  const { projectId } = bs;
  const attemptCount = bs.provisioningAttemptCount;

  // Track ids we resolve along the way (seed from the row for resumption).
  let railwayProjectId = bs.railwayProjectId ?? undefined;
  let railwayEnvironmentId = bs.railwayEnvironmentId ?? undefined;
  let railwayDbServiceId = bs.railwayDbServiceId ?? undefined;
  let railwayBackendServiceId = bs.railwayBackendServiceId ?? undefined;
  let publicUrl = bs.publicUrl ?? undefined;

  try {
    // 1. Ensure the per-app Railway project exists (adopt orphan by name).
    const desiredName = deterministicProjectName(projectId);
    if (!railwayProjectId) {
      const adopted = (await railwayFns.listProjects()).find(
        (p) => p.name === desiredName,
      );
      if (adopted) {
        railwayProjectId = adopted.id;
        logger.info('Adopted existing Railway project by name', { backendServiceId });
      } else {
        const proj = await railwayFns.createProject({ name: desiredName });
        railwayProjectId = proj.id;
      }
    }

    // Always fetch the project so we can resolve its environment and adopt any
    // services that already exist (from a partially-completed earlier attempt).
    const project = await railwayFns.getProject(railwayProjectId);
    if (!railwayEnvironmentId) {
      const env =
        project.environments.find((e) => /prod/i.test(e.name)) ??
        project.environments[0];
      if (!env) {
        throw new Error('Railway project has no environment.');
      }
      railwayEnvironmentId = env.id;
    }
    await prisma.backendService.update({
      where: { id: backendServiceId },
      data: { railwayProjectId, railwayEnvironmentId },
    });

    // 2. Ensure the managed Postgres service (adopt by name, else create).
    if (!railwayDbServiceId) {
      const adopted = project.services.find((s) => s.name === PG_SERVICE_NAME);
      if (adopted) {
        railwayDbServiceId = adopted.id;
      } else {
        const db = await railwayFns.provisionPostgres({
          projectId: railwayProjectId,
          environmentId: railwayEnvironmentId,
          name: PG_SERVICE_NAME,
        });
        railwayDbServiceId = db.id;
      }
      await prisma.backendService.update({
        where: { id: backendServiceId },
        data: { railwayDbServiceId, dbLifecycleStatus: 'LIVE' },
      });
    }

    // 3. Ensure the backend service (adopt by name, else create from template).
    if (!railwayBackendServiceId) {
      const adopted = project.services.find(
        (s) => s.name === BACKEND_SERVICE_NAME,
      );
      if (adopted) {
        railwayBackendServiceId = adopted.id;
      } else {
        const repo = templateRepo();
        const image = templateImage();
        if (!repo && !image) {
          throw new Error('No backend template (repo or image) is configured.');
        }
        const svc = await railwayFns.createService({
          projectId: railwayProjectId,
          environmentId: railwayEnvironmentId,
          name: BACKEND_SERVICE_NAME,
          source: repo ? { repo } : { image: image! },
          branch: repo ? templateBranch() : undefined,
        });
        railwayBackendServiceId = svc.id;
      }
      await prisma.backendService.update({
        where: { id: backendServiceId },
        data: { railwayBackendServiceId },
      });
    }

    // 4. Wire DATABASE_URL via a Railway variable reference to the app's own
    //    Postgres. Idempotent upsert — safe to repeat on every resume. Resolved
    //    server-side at deploy; NEVER written into IPFS files. skipDeploys so the
    //    explicit deploy below is the one we verify.
    const dbVarValue = `\${{${PG_SERVICE_NAME}.DATABASE_URL}}`;
    assertPerAppDbIsolation('DATABASE_URL', dbVarValue);
    await railwayFns.upsertVariable({
      projectId: railwayProjectId,
      environmentId: railwayEnvironmentId,
      serviceId: railwayBackendServiceId,
      name: 'DATABASE_URL',
      value: dbVarValue,
      skipDeploys: true,
    });

    // 5. Ensure a deployment exists. Only TRIGGER a deploy when there is none yet
    //    — on a resume an in-flight deploy is left to finish (no duplicate
    //    deploys, no duplicate billing).
    let dep = await railwayFns.getLatestDeploymentStatus({
      projectId: railwayProjectId,
      serviceId: railwayBackendServiceId,
      environmentId: railwayEnvironmentId,
    });
    if (!dep) {
      await railwayFns.deployServiceInstance({
        serviceId: railwayBackendServiceId,
        environmentId: railwayEnvironmentId,
      });
      dep = await railwayFns.getLatestDeploymentStatus({
        projectId: railwayProjectId,
        serviceId: railwayBackendServiceId,
        environmentId: railwayEnvironmentId,
      });
    }

    // 6. Ensure the public provider domain (operator-only URL).
    if (!publicUrl) {
      const domain = await railwayFns.createServiceDomain({
        serviceId: railwayBackendServiceId,
        environmentId: railwayEnvironmentId,
      });
      publicUrl = `https://${domain.domain.replace(/^https?:\/\//, '')}`;
      await prisma.backendService.update({
        where: { id: backendServiceId },
        data: { publicUrl },
      });
    }

    // 7. Classify the deploy. ACTIVE only on verified SUCCESS.
    if (dep && dep.status === 'SUCCESS') {
      await prisma.backendService.update({
        where: { id: backendServiceId },
        data: {
          status: 'ACTIVE',
          railwayDeploymentId: dep.id,
          failureReason: null,
          provisioningNextRetryAt: null,
        },
      });
      logger.info('Backend provisioned + verified ACTIVE', { backendServiceId });
      return { outcome: 'PROVISIONED', backendServiceId, publicUrl };
    }

    if (dep && TERMINAL_DEPLOY_FAILURE.includes(dep.status)) {
      // A real, terminal build failure — NOT an outage. Fail + tear down.
      return failAndTeardown(
        backendServiceId,
        railwayProjectId,
        `Deploy failed terminally (status: ${dep.status}).`,
        dep.id,
      );
    }

    // Deploy is still in progress (or not visible yet). The build may still
    // succeed, so this is NOT a failure: keep PROVISIONING and re-verify later.
    if (dep?.id) {
      await prisma.backendService
        .update({
          where: { id: backendServiceId },
          data: { railwayDeploymentId: dep.id },
        })
        .catch(() => undefined);
    }
    return deferProvisioning(
      backendServiceId,
      attemptCount,
      `Deploy not yet verified SUCCESS (status: ${dep?.status ?? 'NONE'}); will re-check.`,
    );
  } catch (err) {
    // A provider outage at ANY step keeps the row retryable — never FAILED, never
    // torn down (the resources may be fine; tearing down during an outage would
    // also fail and could orphan billable resources).
    if (err instanceof RailwayApiError && err.isOutage) {
      return deferProvisioning(
        backendServiceId,
        attemptCount,
        'Backend provider outage during provisioning; will retry automatically.',
      );
    }
    // Any other (non-outage) error is a real failure: record it + tear down so a
    // broken partial provision does not keep billing.
    return failAndTeardown(
      backendServiceId,
      railwayProjectId,
      reasonFromError(err),
    );
  }
}

/**
 * Mark a provisioning row FAILED and best-effort tear down its Railway project
 * so a broken partial provision stops billing. Used ONLY for terminal,
 * non-outage failures — never during a provider outage.
 */
async function failAndTeardown(
  backendServiceId: string,
  railwayProjectId: string | undefined,
  reason: string,
  railwayDeploymentId?: string,
): Promise<ProvisionResult> {
  logger.error('Provisioning failed; recording FAILED + attempting teardown', {
    backendServiceId,
    reason,
  });
  await prisma.backendService
    .update({
      where: { id: backendServiceId },
      data: {
        status: 'FAILED',
        failureReason: reason,
        provisioningNextRetryAt: null,
        ...(railwayDeploymentId ? { railwayDeploymentId } : {}),
      },
    })
    .catch(() => undefined);
  if (railwayProjectId) {
    try {
      await railwayFns.deleteProject(railwayProjectId);
      await prisma.backendService
        .update({
          where: { id: backendServiceId },
          data: { dbLifecycleStatus: 'DELETED' },
        })
        .catch(() => undefined);
    } catch (teardownErr) {
      const tr = reasonFromError(teardownErr);
      await prisma.backendService
        .update({
          where: { id: backendServiceId },
          data: {
            dbDeleteFailureReason: `Cleanup after failed provision did not complete (still billing): ${tr}`,
          },
        })
        .catch(() => undefined);
      logger.error('Provision cleanup (deleteProject) failed', {
        backendServiceId,
        reason: tr,
      });
    }
  }
  return { outcome: 'FAILED', backendServiceId, reason };
}
