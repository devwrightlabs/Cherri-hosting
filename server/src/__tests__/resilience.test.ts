/**
 * Phase 11 (RESILIENCE: LANDLORD / BACKEND-PROVIDER OUTAGE) verification.
 *
 * Proves the honest contract of the outage-resilience lane:
 *   - The in-memory health monitor classifies outcomes correctly (a successful
 *     call or an HTTP/GraphQL error means REACHABLE; only a network/timeout means
 *     UNREACHABLE) and its CLIENT-FACING shape never leaks "railway"/host/id/raw.
 *   - Provisioning during a provider OUTAGE stays retryable (PROVISIONING + a
 *     scheduled retry) and is NEVER marked FAILED and NEVER torn down.
 *   - The resumable workflow ADOPTS an orphaned project + services by deterministic
 *     name, so a timed-out attempt cannot create duplicate billable resources, and
 *     marks ACTIVE only after a VERIFIED SUCCESS deploy.
 *   - A terminal (non-outage) deploy failure still FAILS + tears down.
 *   - The retry reconciler self-skips while the lane is off or the provider is
 *     unreachable (it never drives provider calls in those states).
 *   - Pause/resume retry self-skips honestly (no row change) while the live
 *     stop/resume path is off — exactly like the rest of the phase is inert today.
 *
 * Run: `npm test` (node:test via tsx, no extra deps).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  recordRailwayOutcome,
  getRailwayHealth,
  isRailwayUnreachable,
  __resetRailwayMonitor,
} from '../services/railwayStatusMonitor';
import {
  provisionBackend,
  resumeProvisioning,
  __setProvisioningRailwayFns,
} from '../services/provisioningService';
import { retryPendingProviderActions } from '../services/appLifecycleService';
import { runRailwayRetryTick } from '../services/railwayActionReconciler';
import { RailwayApiError } from '../services/railway';
import {
  getGoLiveConfig,
  updateGoLiveConfig,
  isCapabilityEnabled,
} from '../services/goLiveService';
import { prisma } from '../utils/prismaClient';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pin the GO-LIVE master switch OFF for the duration of `fn`, then restore. */
async function withGoLiveOff(fn: () => Promise<void>): Promise<void> {
  const prior = await getGoLiveConfig();
  await updateGoLiveConfig({ goLiveEnabled: false });
  try {
    await fn();
  } finally {
    await updateGoLiveConfig({ goLiveEnabled: prior.goLiveEnabled });
  }
}

/** Pin the GO-LIVE master switch ON for the duration of `fn`, then restore. */
async function withGoLiveOn(fn: () => Promise<void>): Promise<void> {
  const prior = await getGoLiveConfig();
  await updateGoLiveConfig({ goLiveEnabled: true });
  try {
    await fn();
  } finally {
    await updateGoLiveConfig({ goLiveEnabled: prior.goLiveEnabled });
  }
}

/** Create a throwaway user + project; returns ids. Caller cleans up via cleanup(). */
async function makeProject(name = 'phase11'): Promise<{ userId: string; projectId: string }> {
  const user = await prisma.user.create({
    data: { piUserId: `test-${crypto.randomUUID()}`, username: 'phase11-test' },
  });
  const project = await prisma.project.create({
    data: { name: `${name}-${crypto.randomUUID().slice(0, 8)}`, userId: user.id },
  });
  return { userId: user.id, projectId: project.id };
}

/** Create a BackendService row for a project with an explicit status. */
async function makeBackendService(
  projectId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const svc = await prisma.backendService.create({
    data: { projectId, ...data } as never,
  });
  return svc.id;
}

/** Tolerant teardown. */
async function cleanup(userId: string, projectId: string): Promise<void> {
  await prisma.backendService.deleteMany({ where: { projectId } }).catch(() => {});
  await prisma.deployment.deleteMany({ where: { projectId } }).catch(() => {});
  await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

/** A network-level provider outage (status 0 => RailwayApiError.isOutage === true). */
function outageError(): RailwayApiError {
  return new RailwayApiError('connect ETIMEDOUT 10.0.0.1:443', 0);
}

/**
 * Turn the `provisioning` capability fully ON for `fn` (GO-LIVE master + paid
 * attestation + a backend template), then restore the prior config + env. Lets
 * us exercise provisionBackend()'s entry logic, which is BLOCKED until live.
 */
async function withProvisioningCapability(fn: () => Promise<void>): Promise<void> {
  const priorConfig = await getGoLiveConfig();
  const priorImage = process.env.RAILWAY_BACKEND_IMAGE;
  process.env.RAILWAY_BACKEND_IMAGE = 'ghcr.io/cherri/backend:test';
  await updateGoLiveConfig({ goLiveEnabled: true, railwayPaidAttestation: true });
  try {
    await fn();
  } finally {
    await updateGoLiveConfig({
      goLiveEnabled: priorConfig.goLiveEnabled,
      railwayPaidAttestation: priorConfig.railwayPaidAttestation,
    });
    if (priorImage === undefined) delete process.env.RAILWAY_BACKEND_IMAGE;
    else process.env.RAILWAY_BACKEND_IMAGE = priorImage;
  }
}

// ─── Monitor: classification + sanitized health (no leak) ────────────────────

test('the health monitor classifies outcomes and never leaks provider identity', () => {
  __resetRailwayMonitor();

  // Pristine: not actively monitored.
  let h = getRailwayHealth();
  assert.equal(h.state, 'unknown');
  assert.equal(h.operational, null);
  assert.equal(isRailwayUnreachable(), false);

  // A network timeout => UNREACHABLE (outage). The raw reason carries a host/IP.
  recordRailwayOutcome({
    ok: false,
    isOutage: true,
    reason: 'connect ETIMEDOUT railway.app 10.0.0.1:443',
  });
  assert.equal(isRailwayUnreachable(), true);
  h = getRailwayHealth();
  assert.equal(h.state, 'outage');
  assert.equal(h.operational, false);

  // A successful call clears the outage => REACHABLE.
  recordRailwayOutcome({ ok: true, isOutage: false });
  assert.equal(isRailwayUnreachable(), false);
  h = getRailwayHealth();
  assert.equal(h.state, 'operational');
  assert.equal(h.operational, true);

  // An HTTP/GraphQL error is still an ANSWER => stays REACHABLE (not an outage).
  recordRailwayOutcome({ ok: false, isOutage: false, reason: 'GraphQL: bad request' });
  assert.equal(isRailwayUnreachable(), false);
  assert.equal(getRailwayHealth().state, 'operational');

  // Back to outage, then assert the CLIENT-FACING shape is fully sanitized.
  recordRailwayOutcome({
    ok: false,
    isOutage: true,
    reason: 'ECONNREFUSED railway.app host 10.0.0.1',
  });
  const serialized = JSON.stringify(getRailwayHealth()).toLowerCase();
  assert.ok(!serialized.includes('railway'), 'never leaks the provider name');
  assert.ok(!serialized.includes('10.0.0.1'), 'never leaks a host/ip');
  assert.ok(!serialized.includes('econnrefused'), 'never leaks raw error text');
  assert.ok(!serialized.includes('etimedout'), 'never leaks raw error text');

  __resetRailwayMonitor();
});

// ─── Provisioning: outage => retryable PROVISIONING, never FAILED/teardown ────

test('a provider outage during provisioning stays retryable (no FAILED, no teardown)', async () => {
  const { userId, projectId } = await makeProject('prov-outage');
  const backendServiceId = await makeBackendService(projectId, {
    status: 'PROVISIONING',
    provisioningAttemptCount: 0,
  });

  let teardownCalls = 0;
  __setProvisioningRailwayFns({
    // The first provider call in the workflow trips the outage.
    listProjects: async () => {
      throw outageError();
    },
    deleteProject: async () => {
      teardownCalls += 1;
      return true;
    },
  });
  try {
    const res = await resumeProvisioning(backendServiceId);
    assert.equal(res.outcome, 'DEFERRED', 'an outage defers; it never FAILS');
    assert.equal(teardownCalls, 0, 'NEVER tear down during an outage');

    const row = await prisma.backendService.findUnique({ where: { id: backendServiceId } });
    assert.equal(row?.status, 'PROVISIONING', 'stays PROVISIONING (retryable)');
    assert.ok(row?.provisioningNextRetryAt, 'a retry is scheduled');
    assert.equal(row?.provisioningAttemptCount, 1, 'attempt count advances');
    assert.ok(row?.failureReason && row.failureReason.length > 0, 'an honest reason is recorded');
  } finally {
    __setProvisioningRailwayFns(null);
    await cleanup(userId, projectId);
  }
});

// ─── Provisioning: adoption by deterministic name; ACTIVE only on SUCCESS ─────

test('provisioning adopts an orphaned project + services by name (no duplicate create) and only goes ACTIVE on verified SUCCESS', async () => {
  const { userId, projectId } = await makeProject('prov-adopt');
  const backendServiceId = await makeBackendService(projectId, {
    status: 'PROVISIONING',
    provisioningAttemptCount: 1,
  });

  const expectedName = `cherri-app-${projectId}`;
  let createProjectCalls = 0;
  let provisionPgCalls = 0;
  let createServiceCalls = 0;

  __setProvisioningRailwayFns({
    // An orphaned project from a timed-out earlier attempt already exists by name.
    listProjects: async () => [
      { id: 'rw-adopted-proj', name: expectedName, createdAt: new Date().toISOString() },
    ],
    createProject: async () => {
      createProjectCalls += 1;
      return { id: 'rw-should-not-create', name: expectedName, environments: [] };
    },
    // The project already has BOTH services, so neither is re-created.
    getProject: async () => ({
      id: 'rw-adopted-proj',
      name: expectedName,
      environments: [{ id: 'rw-env', name: 'production' }],
      services: [
        { id: 'rw-pg', name: 'postgres' },
        { id: 'rw-backend', name: 'backend' },
      ],
    }),
    provisionPostgres: async () => {
      provisionPgCalls += 1;
      return { id: 'rw-should-not-pg', name: 'postgres' };
    },
    createService: async () => {
      createServiceCalls += 1;
      return { id: 'rw-should-not-svc', name: 'backend' };
    },
    upsertVariable: async () => true,
    // A verified, already-SUCCESS deploy => ACTIVE without a fresh deploy.
    getLatestDeploymentStatus: async () => ({ id: 'rw-dep-ok', status: 'SUCCESS' }),
    createServiceDomain: async () => ({ domain: 'app.example.com' }),
  });
  try {
    const res = await resumeProvisioning(backendServiceId);
    assert.equal(res.outcome, 'PROVISIONED', 'a verified SUCCESS deploy provisions');
    assert.equal(createProjectCalls, 0, 'adopts the project — never creates a duplicate');
    assert.equal(provisionPgCalls, 0, 'adopts Postgres — never creates a duplicate');
    assert.equal(createServiceCalls, 0, 'adopts the backend service — never creates a duplicate');

    const row = await prisma.backendService.findUnique({ where: { id: backendServiceId } });
    assert.equal(row?.status, 'ACTIVE', 'ACTIVE only after a verified SUCCESS');
    assert.equal(row?.railwayProjectId, 'rw-adopted-proj', 'adopted the existing project id');
    assert.equal(row?.railwayDbServiceId, 'rw-pg', 'adopted the existing Postgres id');
    assert.equal(row?.railwayBackendServiceId, 'rw-backend', 'adopted the existing backend id');
    assert.equal(row?.provisioningNextRetryAt, null, 'no retry pending once ACTIVE');
  } finally {
    __setProvisioningRailwayFns(null);
    await cleanup(userId, projectId);
  }
});

// ─── Provisioning: an in-progress deploy is deferred, never faked ACTIVE ──────

test('an in-progress (not-yet-SUCCESS) deploy is deferred, never marked ACTIVE', async () => {
  const { userId, projectId } = await makeProject('prov-building');
  const backendServiceId = await makeBackendService(projectId, {
    status: 'PROVISIONING',
    railwayProjectId: 'rw-proj',
    railwayEnvironmentId: 'rw-env',
    railwayDbServiceId: 'rw-pg',
    railwayBackendServiceId: 'rw-backend',
    publicUrl: 'https://app.example.com',
    provisioningAttemptCount: 0,
  });

  __setProvisioningRailwayFns({
    getProject: async () => ({
      id: 'rw-proj',
      name: `cherri-app-${projectId}`,
      environments: [{ id: 'rw-env', name: 'production' }],
      services: [
        { id: 'rw-pg', name: 'postgres' },
        { id: 'rw-backend', name: 'backend' },
      ],
    }),
    upsertVariable: async () => true,
    // Build is still running — NOT a terminal failure, NOT a success.
    getLatestDeploymentStatus: async () => ({ id: 'rw-dep-building', status: 'BUILDING' }),
  });
  try {
    const res = await resumeProvisioning(backendServiceId);
    assert.equal(res.outcome, 'DEFERRED', 'an unverified deploy defers — never ACTIVE, never FAILED');
    const row = await prisma.backendService.findUnique({ where: { id: backendServiceId } });
    assert.equal(row?.status, 'PROVISIONING', 'stays PROVISIONING while the build finishes');
    assert.ok(row?.provisioningNextRetryAt, 'a re-check is scheduled');
  } finally {
    __setProvisioningRailwayFns(null);
    await cleanup(userId, projectId);
  }
});

// ─── Provisioning: a terminal (non-outage) deploy failure FAILS + tears down ──

test('a terminal deploy failure (non-outage) FAILS and tears down', async () => {
  const { userId, projectId } = await makeProject('prov-failterm');
  const backendServiceId = await makeBackendService(projectId, {
    status: 'PROVISIONING',
    railwayProjectId: 'rw-proj',
    railwayEnvironmentId: 'rw-env',
    railwayDbServiceId: 'rw-pg',
    railwayBackendServiceId: 'rw-backend',
    publicUrl: 'https://app.example.com',
    provisioningAttemptCount: 0,
  });

  let teardownCalls = 0;
  __setProvisioningRailwayFns({
    getProject: async () => ({
      id: 'rw-proj',
      name: `cherri-app-${projectId}`,
      environments: [{ id: 'rw-env', name: 'production' }],
      services: [
        { id: 'rw-pg', name: 'postgres' },
        { id: 'rw-backend', name: 'backend' },
      ],
    }),
    upsertVariable: async () => true,
    getLatestDeploymentStatus: async () => ({ id: 'rw-dep-dead', status: 'FAILED' }),
    deleteProject: async () => {
      teardownCalls += 1;
      return true;
    },
  });
  try {
    const res = await resumeProvisioning(backendServiceId);
    assert.equal(res.outcome, 'FAILED', 'a terminal build failure is a real FAILED');
    assert.equal(teardownCalls, 1, 'a non-outage failure tears down to stop billing');
    const row = await prisma.backendService.findUnique({ where: { id: backendServiceId } });
    assert.equal(row?.status, 'FAILED');
    assert.equal(row?.provisioningNextRetryAt, null, 'no retry on a terminal failure');
  } finally {
    __setProvisioningRailwayFns(null);
    await cleanup(userId, projectId);
  }
});

// ─── Reconciler gating: skip while the lane is off ───────────────────────────

test('the retry reconciler does nothing while the backend lane is OFF', async () => {
  __resetRailwayMonitor();
  const { userId, projectId } = await makeProject('recon-laneoff');
  const backendServiceId = await makeBackendService(projectId, {
    status: 'PROVISIONING',
    provisioningAttemptCount: 0,
    provisioningNextRetryAt: new Date(Date.now() - 60_000), // due
  });

  let providerTouched = 0;
  __setProvisioningRailwayFns({
    listProjects: async () => {
      providerTouched += 1;
      return [];
    },
  });
  try {
    await withGoLiveOff(async () => {
      await runRailwayRetryTick();
    });
    assert.equal(providerTouched, 0, 'lane off => never touches the provider');
    const row = await prisma.backendService.findUnique({ where: { id: backendServiceId } });
    assert.equal(row?.status, 'PROVISIONING', 'the due row is left untouched');
    assert.equal(row?.provisioningAttemptCount, 0, 'no retry was driven');
  } finally {
    __setProvisioningRailwayFns(null);
    await cleanup(userId, projectId);
  }
});

// ─── Reconciler gating: skip while the provider is UNREACHABLE ────────────────

test('the retry reconciler does not drive retries while the provider is unreachable', async () => {
  const { userId, projectId } = await makeProject('recon-outage');
  const backendServiceId = await makeBackendService(projectId, {
    status: 'PROVISIONING',
    provisioningAttemptCount: 0,
    provisioningNextRetryAt: new Date(Date.now() - 60_000), // due
  });

  let providerTouched = 0;
  __setProvisioningRailwayFns({
    listProjects: async () => {
      providerTouched += 1;
      return [];
    },
  });
  try {
    await withGoLiveOn(async () => {
      // Pin the monitor into an outage; the reconciler must back off, not hammer.
      __resetRailwayMonitor();
      recordRailwayOutcome({ ok: false, isOutage: true, reason: 'timeout' });
      assert.equal(isRailwayUnreachable(), true);
      await runRailwayRetryTick();
    });
    assert.equal(providerTouched, 0, 'unreachable => the reconciler backs off');
    const row = await prisma.backendService.findUnique({ where: { id: backendServiceId } });
    assert.equal(row?.status, 'PROVISIONING', 'the due row is left untouched during an outage');
    assert.equal(row?.provisioningAttemptCount, 0, 'no retry was driven');
  } finally {
    __setProvisioningRailwayFns(null);
    __resetRailwayMonitor();
    await cleanup(userId, projectId);
  }
});

// ─── Pause/resume retry: honest self-skip while the live path is off ──────────

test('retryPendingProviderActions self-skips (no row change) while the live stop/resume path is off', async () => {
  const { userId, projectId } = await makeProject('retry-skip');
  const pausePendingId = await makeBackendService(projectId, {
    status: 'PAUSE_PENDING',
    pauseReason: 'user requested',
  });
  // A second project for the RESUME_PENDING row (one BackendService per project).
  const other = await makeProject('retry-skip-2');
  const resumePendingId = await makeBackendService(other.projectId, {
    status: 'RESUME_PENDING',
  });
  try {
    await withGoLiveOff(async () => {
      assert.equal(
        await isCapabilityEnabled('provisioning'),
        false,
        'the live path must be off for this test',
      );
      const res = await retryPendingProviderActions();
      assert.deepEqual(
        res,
        { pauseRetried: 0, pauseEffected: 0, resumeRetried: 0, resumeEffected: 0 },
        'nothing is retried while the live path is off',
      );
      // Rows are untouched — never faked as PAUSED/ACTIVE.
      assert.equal(
        (await prisma.backendService.findUnique({ where: { id: pausePendingId } }))?.status,
        'PAUSE_PENDING',
      );
      assert.equal(
        (await prisma.backendService.findUnique({ where: { id: resumePendingId } }))?.status,
        'RESUME_PENDING',
      );
    });
  } finally {
    await cleanup(userId, projectId);
    await cleanup(other.userId, other.projectId);
  }
});

// ─── provisionBackend honesty: an in-flight PROVISIONING row is never "active" ─

test('provisionBackend reports an in-flight PROVISIONING row as DEFERRED (pending), never EXISTS/active', async () => {
  const { userId, projectId } = await makeProject('prov-inflight');
  // A row deferred by an earlier outage: still PROVISIONING with a scheduled retry.
  await makeBackendService(projectId, {
    status: 'PROVISIONING',
    provisioningAttemptCount: 1,
    provisioningNextRetryAt: new Date(Date.now() + 60_000),
  });
  // The existing-row check returns before any provider call; guard against an
  // accidental second driver being started for the same row.
  let providerTouched = 0;
  __setProvisioningRailwayFns({
    listProjects: async () => {
      providerTouched += 1;
      return [];
    },
  });
  try {
    await withProvisioningCapability(async () => {
      assert.equal(
        await isCapabilityEnabled('provisioning'),
        true,
        'the provisioning capability must be live for this test',
      );
      const res = await provisionBackend(projectId);
      // The route maps EXISTS -> 200 {status:'active'}; a still-provisioning
      // backend MUST NOT take that path. DEFERRED -> honest 202 pending.
      assert.equal(res.outcome, 'DEFERRED', 'in-flight provisioning is pending, not active');
      assert.notEqual(res.outcome, 'EXISTS', 'must never be reported as an active backend');
    });
    assert.equal(providerTouched, 0, 'no second concurrent provisioning driver is started');
  } finally {
    __setProvisioningRailwayFns(null);
    await cleanup(userId, projectId);
  }
});
