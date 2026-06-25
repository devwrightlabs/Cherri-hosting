/**
 * Phase 10 (DATA SAFETY & PORTABILITY) verification.
 *
 * Proves the honest contract of the data-safety lane while it is gated OFF:
 *   - databaseBackups + providerTeardown capabilities report blocked, with reasons.
 *   - createBackup never fakes a STORED backup; it records an honest PENDING.
 *   - DB export is an honest 503 (IntegrationUnavailableError) with no live URI,
 *     and 404s for a non-owner; it never writes to IPFS.
 *   - Site export is CID-first (always available once deployed) and the CAR
 *     archive degrades honestly (ok:false) when the gateway can't produce one.
 *   - Deletion never fakes removal: it unpins real CIDs, full-deletes an app with
 *     no backend, and stays DELETING (rows retained) when a real resource remains.
 *   - The owner-facing project shape never leaks Railway identifiers.
 *
 * Run: `npm test` (node:test via tsx, no extra deps).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  getGoLiveConfig,
  updateGoLiveConfig,
  getCapabilityReadiness,
  isCapabilityEnabled,
} from '../services/goLiveService';
import { createBackup } from '../services/backupService';
import {
  getSiteExportInfo,
  fetchSiteArchive,
  getDbExport,
  ExportError,
} from '../services/exportService';
import {
  deleteProjectFully,
  DeletionError,
  __setUnpinFn,
  __setRailwayTeardownFns,
} from '../services/deletionService';
import { IntegrationUnavailableError } from '../utils/integrations';
import { prisma } from '../utils/prismaClient';

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
async function makeProject(name = 'phase10'): Promise<{ userId: string; projectId: string }> {
  const user = await prisma.user.create({
    data: { piUserId: `test-${crypto.randomUUID()}`, username: 'phase10-test' },
  });
  const project = await prisma.project.create({
    data: { name: `${name}-${crypto.randomUUID().slice(0, 8)}`, userId: user.id },
  });
  return { userId: user.id, projectId: project.id };
}

/** Tolerant teardown — works whether or not deletion already removed the rows. */
async function cleanup(userId: string, projectId: string): Promise<void> {
  await prisma.deployment.deleteMany({ where: { projectId } }).catch(() => {});
  await prisma.project.deleteMany({ where: { id: projectId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

// ─── Capability gating: databaseBackups + providerTeardown ───────────────────

test('databaseBackups + providerTeardown are blocked (with reasons) while GO-LIVE is OFF', async () => {
  await withGoLiveOff(async () => {
    for (const key of ['databaseBackups', 'providerTeardown'] as const) {
      const readiness = await getCapabilityReadiness(key);
      assert.equal(readiness.enabled, false, `${key} must be blocked when master is off`);
      assert.ok(
        readiness.blockedReason && readiness.blockedReason.length > 0,
        `${key} must carry an honest blocked reason`,
      );
      assert.equal(await isCapabilityEnabled(key), false);
    }
  });
});

// ─── Backup: honest-blocked, never a fake STORED ─────────────────────────────

test('createBackup records an honest PENDING and never fakes STORED while gated OFF', async () => {
  const { userId, projectId } = await makeProject('backup');
  const svc = await prisma.backendService.create({
    data: { projectId, railwayDbServiceId: 'rw-db-untouched', dbLifecycleStatus: 'LIVE' },
  });
  try {
    await withGoLiveOff(async () => {
      const res = await createBackup(svc.id, 'AUTO');
      assert.equal(res.effected, false, 'no real backup can be effected while gated');
      assert.ok(res.reason.toLowerCase().includes('not effected'));

      // The recorded row is PENDING (honest), never STORED.
      const backup = await prisma.dbBackup.findUnique({ where: { id: res.backupId! } });
      assert.equal(backup?.status, 'PENDING');
      assert.equal(backup?.locationRef, null, 'a blocked backup has no stored location');

      // No STORED backup may exist for this service, and the service shows PENDING.
      const stored = await prisma.dbBackup.findFirst({
        where: { backendServiceId: svc.id, status: 'STORED' },
      });
      assert.equal(stored, null, 'never a STORED backup without a real verified copy');

      const after = await prisma.backendService.findUnique({ where: { id: svc.id } });
      assert.equal(after?.lastBackupStatus, 'PENDING');
      assert.equal(after?.lastBackupAt, null, 'lastBackupAt is only set on a real STORED backup');
    });
  } finally {
    await prisma.dbBackup.deleteMany({ where: { backendServiceId: svc.id } });
    await cleanup(userId, projectId);
  }
});

// ─── DB export: honest 503, owner-only, never to IPFS ────────────────────────

test('getDbExport is an honest 503 when the project has no backend at all', async () => {
  const { userId, projectId } = await makeProject('dbexport-nobackend');
  try {
    await assert.rejects(
      () => getDbExport(projectId, userId),
      IntegrationUnavailableError,
      'no backend => honest unavailable, never an empty/fake file',
    );
  } finally {
    await cleanup(userId, projectId);
  }
});

test('getDbExport is an honest 503 when the live DB URI is not resolvable yet', async () => {
  const { userId, projectId } = await makeProject('dbexport-nouri');
  await prisma.backendService.create({
    data: { projectId, railwayDbServiceId: 'rw-db-untouched', dbLifecycleStatus: 'LIVE' },
  });
  try {
    await assert.rejects(() => getDbExport(projectId, userId), IntegrationUnavailableError);
  } finally {
    await cleanup(userId, projectId);
  }
});

test('getDbExport 404s for a non-owner (no cross-tenant export)', async () => {
  const { userId, projectId } = await makeProject('dbexport-owner');
  const intruder = await makeProject('intruder');
  try {
    await assert.rejects(
      () => getDbExport(projectId, intruder.userId),
      (err: unknown) => err instanceof ExportError && err.status === 404,
    );
  } finally {
    await cleanup(intruder.userId, intruder.projectId);
    await cleanup(userId, projectId);
  }
});

// ─── Site export: CID-first, honest archive fallback ─────────────────────────

test('getSiteExportInfo returns the CID + public gateway links once a site is live', async () => {
  const { userId, projectId } = await makeProject('siteexport');
  const cid = 'bafybeigdyrtestcidvalue000000000000000000000000000000000';
  await prisma.deployment.create({
    data: { projectId, cid, gateway: `https://gw/ipfs/${cid}`, status: 'ACTIVE', size: 10n },
  });
  try {
    const info = await getSiteExportInfo(projectId, userId);
    assert.equal(info.cid, cid);
    assert.ok(info.gatewayUrls.length >= 1, 'at least one public gateway link');
    assert.ok(info.gatewayUrls.every((u) => u.includes(cid)), 'every link points at the CID');
  } finally {
    await cleanup(userId, projectId);
  }
});

test('getSiteExportInfo 409s when there is no live deployment to export', async () => {
  const { userId, projectId } = await makeProject('siteexport-empty');
  try {
    await assert.rejects(
      () => getSiteExportInfo(projectId, userId),
      (err: unknown) => err instanceof ExportError && err.status === 409,
    );
  } finally {
    await cleanup(userId, projectId);
  }
});

test('getSiteExportInfo 404s for a non-owner', async () => {
  const { userId, projectId } = await makeProject('siteexport-owner');
  const intruder = await makeProject('intruder2');
  try {
    await assert.rejects(
      () => getSiteExportInfo(projectId, intruder.userId),
      (err: unknown) => err instanceof ExportError && err.status === 404,
    );
  } finally {
    await cleanup(intruder.userId, intruder.projectId);
    await cleanup(userId, projectId);
  }
});

test('fetchSiteArchive degrades honestly (ok:false) when the gateway cannot produce a CAR', async () => {
  const realFetch = globalThis.fetch;
  // @ts-expect-error — minimal stub of the global fetch surface for this test.
  globalThis.fetch = async () => ({ ok: false, status: 502, body: null });
  try {
    const res = await fetchSiteArchive('bafyfailcid');
    assert.equal(res.ok, false);
    if (!res.ok) assert.ok(res.reason.length > 0, 'an honest, non-empty reason');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchSiteArchive returns a streamable CAR when the gateway succeeds', async () => {
  const realFetch = globalThis.fetch;
  const fakeBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  // @ts-expect-error — minimal stub of the global fetch surface for this test.
  globalThis.fetch = async () => ({ ok: true, status: 200, body: fakeBody });
  try {
    const res = await fetchSiteArchive('bafyokcid');
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.contentType, 'application/vnd.ipld.car');
      assert.ok(res.filename.endsWith('.car'));
      assert.ok(res.body, 'a readable body stream is handed back for streaming');
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── Deletion: never a fake removal ──────────────────────────────────────────

test('deleteProjectFully fully deletes an app with no backend, unpinning its CID', async () => {
  const { userId, projectId } = await makeProject('del-full');
  const cid = 'bafydeletecid000000000000000000000000000000000000000000';
  await prisma.deployment.create({
    data: { projectId, cid, gateway: `https://gw/ipfs/${cid}`, status: 'ACTIVE', size: 5n },
  });
  const unpinned: string[] = [];
  __setUnpinFn(async (c: string) => {
    unpinned.push(c);
  });
  try {
    const res = await deleteProjectFully(projectId, userId);
    assert.equal(res.status, 'DELETED', 'no backend resources => a real full delete');
    assert.deepEqual(unpinned, [cid], 'the live CID must be unpinned exactly once');

    // Rows are actually gone.
    assert.equal(await prisma.project.findUnique({ where: { id: projectId } }), null);
    assert.equal(
      await prisma.deployment.count({ where: { projectId } }),
      0,
      'deployments are removed too',
    );
  } finally {
    __setUnpinFn(null);
    await cleanup(userId, projectId);
  }
});

test('deleteProjectFully stays DELETING (rows retained) when an unpin cannot be confirmed', async () => {
  const { userId, projectId } = await makeProject('del-unpinfail');
  const cid = 'bafyunpinfail0000000000000000000000000000000000000000000';
  await prisma.deployment.create({
    data: { projectId, cid, gateway: `https://gw/ipfs/${cid}`, status: 'ACTIVE', size: 5n },
  });
  // A real provider error (not a 404 "already gone") must NOT be treated as removed.
  __setUnpinFn(async () => {
    const err = new Error('gateway 500') as Error & { response?: { status: number } };
    err.response = { status: 500 };
    throw err;
  });
  try {
    const res = await deleteProjectFully(projectId, userId);
    assert.equal(res.status, 'DELETING', 'an unconfirmed unpin must never become DELETED');
    assert.ok(res.reason && res.reason.length > 0, 'an honest failure reason is recorded');

    // Rows are retained for retry, and the project is marked DELETING with the reason.
    const proj = await prisma.project.findUnique({ where: { id: projectId } });
    assert.ok(proj, 'rows are retained — never faked as removed');
    assert.equal(proj?.lifecycleStatus, 'DELETING');
    assert.ok(proj?.deletionFailureReason && proj.deletionFailureReason.length > 0);
  } finally {
    __setUnpinFn(null);
    await cleanup(userId, projectId);
  }
});

test('deleteProjectFully stays DELETING when backend resources exist but providerTeardown is OFF', async () => {
  const { userId, projectId } = await makeProject('del-backend');
  // No CID => the unpin path is skipped; the backend resources are the blocker.
  await prisma.backendService.create({
    data: {
      projectId,
      railwayProjectId: 'rw-proj-untouched',
      railwayDbServiceId: 'rw-db-untouched',
      dbLifecycleStatus: 'LIVE',
    },
  });
  try {
    await withGoLiveOff(async () => {
      assert.equal(await isCapabilityEnabled('providerTeardown'), false);
      const res = await deleteProjectFully(projectId, userId);
      assert.equal(res.status, 'DELETING', 'cannot claim deleted while real backend resources remain');
      assert.ok(res.reason?.toLowerCase().includes('teardown'));

      const proj = await prisma.project.findUnique({ where: { id: projectId } });
      assert.ok(proj, 'rows retained while backend resources still exist');
      assert.equal(proj?.lifecycleStatus, 'DELETING');
    });
  } finally {
    await cleanup(userId, projectId);
  }
});

test('deleteProjectFully stays DELETING when Railway returns false (unconfirmed teardown)', async () => {
  const { userId, projectId } = await makeProject('del-rwfalse');
  // No CID => unpin skipped; the Railway teardown is the only step under test.
  await prisma.backendService.create({
    data: { projectId, railwayProjectId: 'rw-proj-unconfirmed', dbLifecycleStatus: 'LIVE' },
  });
  let called = 0;
  // A mutation that returns false is NOT a confirmed teardown — never DELETED.
  __setRailwayTeardownFns({
    deleteProject: async () => {
      called += 1;
      return false;
    },
  });
  try {
    await withGoLiveOn(async () => {
      assert.equal(await isCapabilityEnabled('providerTeardown'), true, 'gate must be open for this test');
      const res = await deleteProjectFully(projectId, userId);
      assert.equal(called, 1, 'the teardown was attempted');
      assert.equal(res.status, 'DELETING', 'a false (unconfirmed) teardown must never become DELETED');

      const proj = await prisma.project.findUnique({ where: { id: projectId } });
      assert.ok(proj, 'rows retained — never faked as removed on an unconfirmed teardown');
      assert.equal(proj?.lifecycleStatus, 'DELETING');
      assert.ok(proj?.deletionFailureReason && proj.deletionFailureReason.length > 0);
    });
  } finally {
    __setRailwayTeardownFns(null);
    await cleanup(userId, projectId);
  }
});

test('deleteProjectFully fully deletes once Railway confirms (true) the teardown', async () => {
  const { userId, projectId } = await makeProject('del-rwtrue');
  await prisma.backendService.create({
    data: { projectId, railwayProjectId: 'rw-proj-confirmed', dbLifecycleStatus: 'LIVE' },
  });
  let called = 0;
  __setRailwayTeardownFns({
    deleteProject: async () => {
      called += 1;
      return true;
    },
  });
  try {
    await withGoLiveOn(async () => {
      const res = await deleteProjectFully(projectId, userId);
      assert.equal(called, 1, 'the teardown was attempted exactly once');
      assert.equal(res.status, 'DELETED', 'a confirmed teardown with no other blockers is a real delete');
      assert.equal(await prisma.project.findUnique({ where: { id: projectId } }), null);
    });
  } finally {
    __setRailwayTeardownFns(null);
    await cleanup(userId, projectId);
  }
});

test('deleteProjectFully 404s for a non-owner (no cross-tenant deletion)', async () => {
  const { userId, projectId } = await makeProject('del-owner');
  const intruder = await makeProject('intruder3');
  try {
    await assert.rejects(
      () => deleteProjectFully(projectId, intruder.userId),
      (err: unknown) => err instanceof DeletionError && err.status === 404,
    );
    // The real owner's project is untouched.
    assert.ok(await prisma.project.findUnique({ where: { id: projectId } }));
  } finally {
    await cleanup(intruder.userId, intruder.projectId);
    await cleanup(userId, projectId);
  }
});

// ─── No Railway identifiers ever leak in the owner-facing project shape ───────

test('the owner-facing project shape never exposes Railway identifiers', async () => {
  const { userId, projectId } = await makeProject('leak');
  await prisma.backendService.create({
    data: {
      projectId,
      railwayProjectId: 'rw-secret-project-id',
      railwayBackendServiceId: 'rw-secret-backend-id',
      railwayDbServiceId: 'rw-secret-db-id',
      railwayEnvironmentId: 'rw-secret-env-id',
      publicUrl: 'https://secret.up.railway.app',
      lastBackupStatus: 'PENDING',
    },
  });
  try {
    // The exact include/select the GET /api/projects/:id route uses.
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, cid: true, gateway: true, status: true, size: true, createdAt: true },
        },
        backendService: {
          select: {
            status: true,
            lastBackupAt: true,
            lastBackupStatus: true,
            lastBackupFailureReason: true,
          },
        },
      },
    });
    const serialized = JSON.stringify(project, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ).toLowerCase();

    assert.ok(!serialized.includes('railway'), 'no Railway field names may surface');
    for (const secret of [
      'rw-secret-project-id',
      'rw-secret-backend-id',
      'rw-secret-db-id',
      'rw-secret-env-id',
      'up.railway.app',
    ]) {
      assert.ok(!serialized.includes(secret), `must not leak ${secret}`);
    }
    // The safe backup status fields ARE present.
    assert.ok(project?.backendService);
    assert.equal(project?.backendService?.lastBackupStatus, 'PENDING');
  } finally {
    await cleanup(userId, projectId);
  }
});
