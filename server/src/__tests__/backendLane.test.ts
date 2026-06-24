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
  isS3Provider,
  s3ConfigMissing,
  createS3SnapshotStore,
  MAX_SINGLE_PUT_BYTES,
} from '../services/snapshotStoreS3';
import {
  getGoLiveConfig,
  updateGoLiveConfig,
  goLiveReadiness,
} from '../services/goLiveService';
import { isSnapshotStoreConfigured } from '../utils/integrations';
import { prisma } from '../utils/prismaClient';

/** Run `fn` with the given env vars set, restoring prior values afterwards. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const FULL_S3_ENV = {
  SNAPSHOT_S3_BUCKET: 'cherri-snapshots',
  SNAPSHOT_S3_ACCESS_KEY_ID: 'test-akid',
  SNAPSHOT_S3_SECRET_ACCESS_KEY: 'test-secret',
  SNAPSHOT_S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
};

/** Async variant of withEnv for tests that await inside the env scope. */
async function withEnvAsync(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** In-memory fake of the S3 client send() surface for adapter round-trip tests. */
function makeFakeS3() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const client = {
    async send(command: any): Promise<any> {
      const name = command?.constructor?.name ?? 'Unknown';
      calls.push(name);
      const input = command.input ?? {};
      if (name === 'PutObjectCommand') {
        objects.set(input.Key, Buffer.from(input.Body));
        return {};
      }
      if (name === 'GetObjectCommand') {
        const buf = objects.get(input.Key);
        if (!buf) {
          const err = new Error('NoSuchKey') as Error & { name: string };
          err.name = 'NoSuchKey';
          throw err;
        }
        return { Body: { transformToByteArray: async () => new Uint8Array(buf) } };
      }
      if (name === 'DeleteObjectCommand') {
        objects.delete(input.Key);
        return {};
      }
      throw new Error(`unexpected S3 command ${name}`);
    },
  };
  return { client, objects, calls };
}

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

test('resolveSnapshotStore throws honestly for a provider with no adapter', () => {
  withEnv({ SNAPSHOT_STORE_PROVIDER: 'azure-blob' }, () => {
    assert.throws(() => resolveSnapshotStore(), SnapshotStoreError);
  });
});

// ─── S3-compatible adapter (no network: construction + config only) ──────────

test('isS3Provider recognizes the S3-compatible family and rejects others', () => {
  for (const p of ['s3', 'AWS-S3', 'r2', 'cloudflare-r2', 'gcs', 'minio']) {
    assert.equal(isS3Provider(p), true, `${p} should be S3-compatible`);
  }
  for (const p of ['azure-blob', 'backblaze', 'dropbox', '']) {
    assert.equal(isS3Provider(p), false, `${p} should not be S3-compatible`);
  }
});

test('s3ConfigMissing lists every absent credential, empty when complete', () => {
  withEnv(
    {
      SNAPSHOT_S3_BUCKET: undefined,
      SNAPSHOT_S3_ACCESS_KEY_ID: undefined,
      SNAPSHOT_S3_SECRET_ACCESS_KEY: undefined,
    },
    () => {
      assert.deepEqual(s3ConfigMissing('s3'), [
        'SNAPSHOT_S3_BUCKET',
        'SNAPSHOT_S3_ACCESS_KEY_ID',
        'SNAPSHOT_S3_SECRET_ACCESS_KEY',
      ]);
    },
  );
  withEnv(FULL_S3_ENV, () => {
    assert.deepEqual(s3ConfigMissing('s3'), []);
  });
});

test('s3ConfigMissing requires an endpoint for non-AWS providers (R2/GCS/MinIO)', () => {
  // AWS-native derives its endpoint from the region, so endpoint is not required.
  withEnv({ ...FULL_S3_ENV, SNAPSHOT_S3_ENDPOINT: undefined }, () => {
    assert.deepEqual(s3ConfigMissing('s3'), []);
  });
  // A non-AWS provider with no endpoint is not usable -> reported missing.
  withEnv({ ...FULL_S3_ENV, SNAPSHOT_S3_ENDPOINT: undefined }, () => {
    assert.deepEqual(s3ConfigMissing('r2'), ['SNAPSHOT_S3_ENDPOINT']);
  });
  // With its endpoint supplied it is complete.
  withEnv(FULL_S3_ENV, () => {
    assert.deepEqual(s3ConfigMissing('r2'), []);
  });
});

test('resolveSnapshotStore throws when an S3 provider is selected but uncredentialed', () => {
  withEnv(
    {
      SNAPSHOT_STORE_PROVIDER: 's3',
      SNAPSHOT_S3_BUCKET: undefined,
      SNAPSHOT_S3_ACCESS_KEY_ID: undefined,
      SNAPSHOT_S3_SECRET_ACCESS_KEY: undefined,
    },
    () => {
      assert.throws(() => resolveSnapshotStore(), SnapshotStoreError);
    },
  );
});

test('resolveSnapshotStore builds a fully-credentialed S3 store (no network on construct)', () => {
  withEnv({ SNAPSHOT_STORE_PROVIDER: 'r2', ...FULL_S3_ENV }, () => {
    const store = resolveSnapshotStore();
    assert.ok(store, 'store should resolve');
    assert.equal(store!.provider, 'r2');
    for (const m of ['put', 'get', 'verify', 'remove'] as const) {
      assert.equal(typeof store![m], 'function', `store.${m} must exist`);
    }
  });
});

test('createS3SnapshotStore refuses to build without credentials', () => {
  withEnv(
    {
      SNAPSHOT_S3_BUCKET: undefined,
      SNAPSHOT_S3_ACCESS_KEY_ID: undefined,
      SNAPSHOT_S3_SECRET_ACCESS_KEY: undefined,
    },
    () => {
      assert.throws(() => createS3SnapshotStore('s3'));
    },
  );
});

test('isSnapshotStoreConfigured is true only when a usable store is fully wired', () => {
  withEnv({ SNAPSHOT_STORE_PROVIDER: undefined }, () => {
    assert.equal(isSnapshotStoreConfigured(), false);
  });
  withEnv(
    {
      SNAPSHOT_STORE_PROVIDER: 's3',
      SNAPSHOT_S3_BUCKET: undefined,
      SNAPSHOT_S3_ACCESS_KEY_ID: undefined,
      SNAPSHOT_S3_SECRET_ACCESS_KEY: undefined,
    },
    () => {
      assert.equal(isSnapshotStoreConfigured(), false);
    },
  );
  withEnv({ SNAPSHOT_STORE_PROVIDER: 'azure-blob' }, () => {
    assert.equal(isSnapshotStoreConfigured(), false);
  });
  withEnv({ SNAPSHOT_STORE_PROVIDER: 's3', ...FULL_S3_ENV }, () => {
    assert.equal(isSnapshotStoreConfigured(), true);
  });
});

test('isSnapshotStoreConfigured is false for a non-AWS provider lacking its endpoint', () => {
  withEnv(
    { SNAPSHOT_STORE_PROVIDER: 'r2', ...FULL_S3_ENV, SNAPSHOT_S3_ENDPOINT: undefined },
    () => {
      assert.equal(isSnapshotStoreConfigured(), false);
    },
  );
});

test('S3 adapter put/get/verify/remove round-trips against a mocked client', async () => {
  await withEnvAsync({ SNAPSHOT_STORE_PROVIDER: 's3', ...FULL_S3_ENV }, async () => {
    const { client, objects } = makeFakeS3();
    const store = createS3SnapshotStore('s3', client);
    const data = Buffer.from('opaque-encrypted-ciphertext');

    const stored = await store.put('snapshots/svc/abc.enc', data);
    assert.equal(stored.locationRef, 'snapshots/svc/abc.enc');
    assert.equal(stored.sizeBytes, data.length);

    // get returns the exact bytes that were stored.
    const got = await store.get(stored.locationRef);
    assert.deepEqual(got, data);

    // verify is true only for the real checksum, false for a wrong one.
    assert.equal(await store.verify(stored.locationRef, stored.checksum), true);
    assert.equal(await store.verify(stored.locationRef, 'not-the-checksum'), false);

    // after removal the object is gone, so verify is false (never a throw).
    await store.remove(stored.locationRef);
    assert.equal(await store.verify(stored.locationRef, stored.checksum), false);
    assert.equal(objects.size, 0);
  });
});

test('S3 adapter applies the configured key prefix', async () => {
  await withEnvAsync(
    { SNAPSHOT_STORE_PROVIDER: 's3', ...FULL_S3_ENV, SNAPSHOT_S3_PREFIX: 'cherri/prod' },
    async () => {
      const { client, objects } = makeFakeS3();
      const store = createS3SnapshotStore('s3', client);
      const stored = await store.put('snapshots/x.enc', Buffer.from('z'));
      assert.equal(stored.locationRef, 'cherri/prod/snapshots/x.enc');
      assert.ok(objects.has('cherri/prod/snapshots/x.enc'));
    },
  );
});

test('S3 adapter refuses an over-limit object without attempting an upload', async () => {
  await withEnvAsync({ SNAPSHOT_STORE_PROVIDER: 's3', ...FULL_S3_ENV }, async () => {
    const { client, calls } = makeFakeS3();
    const store = createS3SnapshotStore('s3', client);
    const oversize = { length: MAX_SINGLE_PUT_BYTES + 1 } as unknown as Buffer;
    await assert.rejects(() => store.put('snapshots/big.enc', oversize));
    assert.equal(calls.length, 0, 'no upload should be attempted for an over-limit object');
  });
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
