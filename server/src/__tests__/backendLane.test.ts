/**
 * Backend-lane (WOODSTICK Phases 2/3/4/7) verification.
 *
 * Pure tests cover the metering math, at-rest snapshot crypto, and snapshot-store
 * resolution. DB-backed tests rely on the GO-LIVE master switch being OFF (which we
 * assert and pin for the run) to prove the honest-inert contract: nothing samples,
 * charges, or deletes while the lane is dark.
 *
 * Run: `npm test` (node:test via tsx, no extra deps).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  consumedFromReadings,
  overageCents,
  computeOverageForUser,
  sampleAllUsage,
} from '../services/meteringService';
import { encryptSnapshot, decryptSnapshot, snapshotAndDelete } from '../services/snapshotService';
import { resolveSnapshotStore, SnapshotStoreError } from '../services/snapshotStore';
import {
  getGoLiveConfig,
  updateGoLiveConfig,
  goLiveReadiness,
} from '../services/goLiveService';
import { prisma } from '../utils/prismaClient';

// ─── Pure: metering math ─────────────────────────────────────────────────────

test('consumedFromReadings sums positive deltas across a monotonic series', () => {
  assert.equal(consumedFromReadings([10, 12, 15, 20]), 10); // 2 + 3 + 5
});

test('consumedFromReadings is reset-aware (drop counts new reading from zero)', () => {
  // 10->13 (+3), reset to 2 (counts 2), 2->5 (+3) => 8. Never a negative delta.
  assert.equal(consumedFromReadings([10, 13, 2, 5]), 8);
});

test('consumedFromReadings yields 0 for fewer than two readings', () => {
  assert.equal(consumedFromReadings([]), 0);
  assert.equal(consumedFromReadings([42]), 0);
});

test('overageCents never charges at or under the included allowance', () => {
  assert.equal(overageCents(5, 10, 100), 0); // under
  assert.equal(overageCents(10, 10, 100), 0); // exact
});

test('overageCents rounds a partial overage GB up (never undercharge)', () => {
  // 0.5 GB over @ 100c/GB => ceil(50) = 50
  assert.equal(overageCents(10.5, 10, 100), 50);
  // 2 GB over @ 100c/GB => 200
  assert.equal(overageCents(12, 10, 100), 200);
});

// ─── Pure: snapshot at-rest crypto ───────────────────────────────────────────

test('encrypt/decrypt round-trips and detects tampering', () => {
  const prevKey = process.env.SNAPSHOT_ENCRYPTION_KEY;
  process.env.SNAPSHOT_ENCRYPTION_KEY = 'unit-test-passphrase';
  try {
    const plain = crypto.randomBytes(2048);
    const enc = encryptSnapshot(plain);
    assert.notDeepEqual(enc, plain);
    assert.deepEqual(decryptSnapshot(enc), plain);

    // Flip a ciphertext byte => GCM auth tag rejects it.
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1] ^= 0xff;
    assert.throws(() => decryptSnapshot(tampered));
  } finally {
    if (prevKey === undefined) delete process.env.SNAPSHOT_ENCRYPTION_KEY;
    else process.env.SNAPSHOT_ENCRYPTION_KEY = prevKey;
  }
});

// ─── Pure: snapshot store resolution (blocked w/o a real adapter) ────────────

test('resolveSnapshotStore is null (inert) when no provider configured', () => {
  const prev = process.env.SNAPSHOT_STORE_PROVIDER;
  delete process.env.SNAPSHOT_STORE_PROVIDER;
  try {
    assert.equal(resolveSnapshotStore(), null);
  } finally {
    if (prev !== undefined) process.env.SNAPSHOT_STORE_PROVIDER = prev;
  }
});

test('resolveSnapshotStore throws honestly for a configured-but-unimplemented provider', () => {
  const prev = process.env.SNAPSHOT_STORE_PROVIDER;
  process.env.SNAPSHOT_STORE_PROVIDER = 's3';
  try {
    assert.throws(() => resolveSnapshotStore(), SnapshotStoreError);
  } finally {
    if (prev === undefined) delete process.env.SNAPSHOT_STORE_PROVIDER;
    else process.env.SNAPSHOT_STORE_PROVIDER = prev;
  }
});

// ─── DB-backed: honest-inert contract while GO-LIVE is OFF ───────────────────

test('backend lane stays inert while GO-LIVE master switch is OFF', async (t) => {
  // Pin the switch OFF for this run, remembering the prior operator state.
  const prior = await getGoLiveConfig();
  await updateGoLiveConfig({ goLiveEnabled: false });

  const readiness = await goLiveReadiness();
  assert.equal(readiness.masterEnabled, false, 'master switch should be off');
  for (const [key, cap] of Object.entries(readiness.capabilities)) {
    assert.equal(cap.enabled, false, `capability ${key} must be blocked when off`);
  }

  await t.test('sampleAllUsage makes no provider calls and writes nothing', async () => {
    const res = await sampleAllUsage();
    assert.deepEqual(res, { attempted: 0, written: 0, skipped: 0 });
  });

  await t.test('computeOverageForUser reports unavailable and charges 0', async () => {
    const res = await computeOverageForUser({
      userId: 'nonexistent-user',
      plan: 'PREMIUM',
      cycleStart: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      cycleEnd: new Date(),
    });
    assert.equal(res.cents, 0);
    assert.equal(res.source, 'METERING_UNAVAILABLE');
  });

  await t.test('snapshotAndDelete never deletes a DB while blocked', async () => {
    // Minimal fixture with a provisioned DB to exercise the guarded delete path.
    const user = await prisma.user.create({
      data: { piUserId: `test-${crypto.randomUUID()}`, username: 'lane-test' },
    });
    const project = await prisma.project.create({
      data: { name: 'lane-test', userId: user.id },
    });
    const svc = await prisma.backendService.create({
      data: {
        projectId: project.id,
        railwayDbServiceId: 'rw-db-should-never-be-touched',
        dbLifecycleStatus: 'LIVE',
      },
    });
    try {
      const res = await snapshotAndDelete(svc.id);
      assert.equal(res.effected, false, 'must not effect a delete while blocked');

      const after = await prisma.backendService.findUnique({ where: { id: svc.id } });
      assert.notEqual(after?.dbLifecycleStatus, 'DELETED', 'DB must not be deleted');
      assert.notEqual(after?.dbLifecycleStatus, 'DELETE_PENDING', 'delete must not be queued');

      const stored = await prisma.dbSnapshot.findFirst({
        where: { backendServiceId: svc.id, status: 'STORED' },
      });
      assert.equal(stored, null, 'no snapshot may be marked STORED without a real store');
    } finally {
      await prisma.dbSnapshot.deleteMany({ where: { backendServiceId: svc.id } });
      await prisma.backendService.delete({ where: { id: svc.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  // Restore the operator's prior switch state.
  await updateGoLiveConfig({ goLiveEnabled: prior.goLiveEnabled });
});

test.after(async () => {
  await prisma.$disconnect();
});
