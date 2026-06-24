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
  createProject,
  createService,
  provisionPostgres,
  upsertVariable,
  deployServiceInstance,
  createServiceDomain,
  getLatestDeploymentStatus,
  deleteProject,
  RailwayApiError,
} from './railway';

export type ProvisionOutcome =
  | 'PROVISIONED'
  | 'EXISTS'
  | 'BLOCKED'
  | 'CAP_REACHED'
  | 'FAILED';

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
      return {
        outcome: 'EXISTS',
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

  let railwayProjectId: string | undefined;
  try {
    // 1. Create the per-app Railway project.
    const proj = await createProject({
      name: `cherri-${projectId.slice(0, 8)}-${Date.now().toString(36)}`,
    });
    railwayProjectId = proj.id;
    const env =
      proj.environments.find((e) => /prod/i.test(e.name)) ??
      proj.environments[0];
    if (!env) {
      throw new Error('Railway project was created without an environment.');
    }
    await prisma.backendService.update({
      where: { id: backendServiceId },
      data: { railwayProjectId: proj.id, railwayEnvironmentId: env.id },
    });

    // 2. Provision the managed Postgres database.
    const db = await provisionPostgres({
      projectId: proj.id,
      environmentId: env.id,
      name: PG_SERVICE_NAME,
    });
    await prisma.backendService.update({
      where: { id: backendServiceId },
      data: { railwayDbServiceId: db.id, dbLifecycleStatus: 'LIVE' },
    });

    // 3. Create the backend service from the operator's template (repo|image).
    const repo = templateRepo();
    const image = templateImage();
    const svc = await createService({
      projectId: proj.id,
      environmentId: env.id,
      name: 'backend',
      source: repo ? { repo } : { image: image! },
      branch: repo ? templateBranch() : undefined,
    });
    await prisma.backendService.update({
      where: { id: backendServiceId },
      data: { railwayBackendServiceId: svc.id },
    });

    // 4. Wire DATABASE_URL into the backend via a Railway variable reference to
    //    the Postgres service. Resolved server-side at deploy — NEVER written
    //    into IPFS files. skipDeploys so the explicit deploy below is the one
    //    we verify.
    const dbVarValue = `\${{${PG_SERVICE_NAME}.DATABASE_URL}}`;
    assertPerAppDbIsolation('DATABASE_URL', dbVarValue);
    await upsertVariable({
      projectId: proj.id,
      environmentId: env.id,
      serviceId: svc.id,
      name: 'DATABASE_URL',
      value: dbVarValue,
      skipDeploys: true,
    });

    // 5. Deploy the backend service.
    await deployServiceInstance({
      serviceId: svc.id,
      environmentId: env.id,
    });

    // 6. Create the public provider domain (operator-only URL).
    const domain = await createServiceDomain({
      serviceId: svc.id,
      environmentId: env.id,
    });
    const publicUrl = `https://${domain.domain.replace(/^https?:\/\//, '')}`;
    await prisma.backendService.update({
      where: { id: backendServiceId },
      data: { publicUrl },
    });

    // 7. VERIFY the deploy actually reached SUCCESS before marking ACTIVE.
    const dep = await getLatestDeploymentStatus({
      projectId: proj.id,
      serviceId: svc.id,
      environmentId: env.id,
    });
    if (!dep || dep.status !== 'SUCCESS') {
      const reason = `Deploy not verified SUCCESS (status: ${dep?.status ?? 'NONE'}).`;
      await prisma.backendService.update({
        where: { id: backendServiceId },
        data: {
          status: 'FAILED',
          failureReason: reason,
          railwayDeploymentId: dep?.id ?? null,
        },
      });
      return { outcome: 'FAILED', backendServiceId, reason };
    }

    // 8. Verified deploy + public URL -> ACTIVE.
    await prisma.backendService.update({
      where: { id: backendServiceId },
      data: {
        status: 'ACTIVE',
        railwayDeploymentId: dep.id,
        failureReason: null,
      },
    });
    logger.info('Backend provisioned + verified ACTIVE', { backendServiceId });
    return { outcome: 'PROVISIONED', backendServiceId, publicUrl };
  } catch (err) {
    const reason = reasonFromError(err);
    logger.error('Provisioning failed; recording FAILED + attempting teardown', {
      backendServiceId,
      reason,
    });
    await prisma.backendService
      .update({
        where: { id: backendServiceId },
        data: { status: 'FAILED', failureReason: reason },
      })
      .catch(() => undefined);
    // Best-effort teardown so a partial provision does not keep billing.
    if (railwayProjectId) {
      try {
        await deleteProject(railwayProjectId);
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
}
