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
import { Prisma } from '@prisma/client';

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
import { isSnapshotStoreConfigured, IntegrationUnavailableError } from '../utils/integrations';
import {
  processServicePage,
  verifyAllowanceApproval,
  revokeAllowance,
  __setPirc2ChainClient,
  Pirc2ChainClient,
  ProcessPageResult,
  ApprovalTxInfo,
} from '../services/pirc2Service';
import { runBillingTick } from '../services/billingScheduler';
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

// ─── PiRC2 Phase 8: on-chain recurring draws (mocked chain client) ───────────

/** Full testnet PiRC2 env (a dummy merchant secret — the fake client is
 *  injected, so Keypair.fromSecret is never exercised). */
const PIRC2_TESTNET_ENV = {
  PIRC2_CONTRACT_ID: 'CCUF75B6W3HRJTJD6O7OXNI72HGJ7DERZ5MUNOMFMSK23ME5GUIKPFYV',
  SOROBAN_RPC_URL: 'https://rpc.testnet.minepi.com',
  PIRC2_NETWORK_PASSPHRASE: 'Pi Testnet',
  PIRC2_MERCHANT_SECRET: 'test-merchant-secret',
  PIRC2_BLOCKED_PASSPHRASES: undefined,
};
const STELLAR_MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

interface FakeChain {
  client: Pirc2ChainClient;
  calls: { submitProcess: number; fetchApprovalTx: number; lastProcess?: unknown };
}
function makeFakeChain(opts: {
  process?: (input: { serviceId: string; offset: number; limit: number }) => ProcessPageResult;
  approval?: (txId: string) => ApprovalTxInfo | null;
} = {}): FakeChain {
  const calls: FakeChain['calls'] = { submitProcess: 0, fetchApprovalTx: 0 };
  return {
    calls,
    client: {
      async submitProcess(input) {
        calls.submitProcess += 1;
        calls.lastProcess = input;
        return (
          opts.process?.(input) ?? {
            txId: 'tx-empty',
            result: { charged: 0, failed: 0, skipped: 0, total: 0 },
            events: [],
          }
        );
      },
      async fetchApprovalTx(txId) {
        calls.fetchApprovalTx += 1;
        return opts.approval ? opts.approval(txId) : null;
      },
    },
  };
}

test('processServicePage is honest-inert (503) and makes no chain call when unconfigured', async () => {
  const fake = makeFakeChain();
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(
      {
        PIRC2_CONTRACT_ID: undefined,
        SOROBAN_RPC_URL: undefined,
        PIRC2_NETWORK_PASSPHRASE: undefined,
        PIRC2_MERCHANT_SECRET: undefined,
      },
      async () => {
        await assert.rejects(() => processServicePage('1', 0, 50), IntegrationUnavailableError);
      },
    );
    assert.equal(fake.calls.submitProcess, 0, 'unconfigured must never reach the chain');
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('processServicePage refuses to draw without a merchant signer (no chain call)', async () => {
  const fake = makeFakeChain();
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync({ ...PIRC2_TESTNET_ENV, PIRC2_MERCHANT_SECRET: undefined }, async () => {
      await assert.rejects(() => processServicePage('1', 0, 50), IntegrationUnavailableError);
    });
    assert.equal(fake.calls.submitProcess, 0);
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('processServicePage refuses a known production/mainnet network (no chain call)', async () => {
  const fake = makeFakeChain();
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(
      { ...PIRC2_TESTNET_ENV, PIRC2_NETWORK_PASSPHRASE: STELLAR_MAINNET_PASSPHRASE },
      async () => {
        await assert.rejects(() => processServicePage('1', 0, 50), IntegrationUnavailableError);
      },
    );
    assert.equal(fake.calls.submitProcess, 0, 'mainnet passphrase must be blocked before any RPC');
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('processServicePage fails closed on an unknown/unlisted network passphrase (no chain call)', async () => {
  const fake = makeFakeChain();
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(
      { ...PIRC2_TESTNET_ENV, PIRC2_NETWORK_PASSPHRASE: 'Some Unknown Network ; 2099' },
      async () => {
        await assert.rejects(() => processServicePage('1', 0, 50), IntegrationUnavailableError);
      },
    );
    assert.equal(fake.calls.submitProcess, 0, 'unlisted passphrase must fail closed before any RPC');
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('processServicePage refuses a non-https Soroban RPC endpoint (no chain call)', async () => {
  const fake = makeFakeChain();
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(
      { ...PIRC2_TESTNET_ENV, SOROBAN_RPC_URL: 'http://rpc.testnet.minepi.com' },
      async () => {
        await assert.rejects(() => processServicePage('1', 0, 50), IntegrationUnavailableError);
      },
    );
    assert.equal(fake.calls.submitProcess, 0, 'plaintext RPC must be refused before any RPC');
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('processServicePage delegates to the chain client and returns parsed events on testnet', async () => {
  const fake = makeFakeChain({
    process: (input) => ({
      txId: 'tx-draw',
      result: { charged: 1, failed: 1, skipped: 3, total: 5 },
      events: [
        { kind: 'charge', subscriberAddress: 'GSUB1', serviceId: input.serviceId, txId: 'tx-draw' },
        { kind: 'chg_fail', subscriberAddress: 'GSUB2', serviceId: input.serviceId, txId: 'tx-draw' },
      ],
    }),
  });
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(PIRC2_TESTNET_ENV, async () => {
      const out = await processServicePage('7', 0, 50);
      assert.equal(fake.calls.submitProcess, 1);
      assert.deepEqual(fake.calls.lastProcess, { serviceId: '7', offset: 0, limit: 50 });
      assert.equal(out.result.charged, 1);
      assert.equal(out.events.length, 2);
      assert.equal(out.events[0].kind, 'charge');
      assert.equal(out.events[0].subscriberAddress, 'GSUB1');
      assert.equal(out.events[1].kind, 'chg_fail');
    });
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('verifyAllowanceApproval is honest-inert (503) when PiRC2 is unconfigured', async () => {
  const fake = makeFakeChain();
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(
      { PIRC2_CONTRACT_ID: undefined, SOROBAN_RPC_URL: undefined, PIRC2_NETWORK_PASSPHRASE: undefined },
      async () => {
        await assert.rejects(
          () => verifyAllowanceApproval({ approvalTxId: 't', subscriberAddress: 'GSUB' }),
          IntegrationUnavailableError,
        );
      },
    );
    assert.equal(fake.calls.fetchApprovalTx, 0);
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('verifyAllowanceApproval rejects unrelated / failed / wrong-actor approval transactions', async () => {
  await withEnvAsync(PIRC2_TESTNET_ENV, async () => {
    const base = {
      succeeded: true,
      contractId: PIRC2_TESTNET_ENV.PIRC2_CONTRACT_ID,
      functionName: 'subscribe',
      subscriberAddress: 'GSUB',
      serviceId: '42',
      subId: '1001',
    };
    const cases: Array<{ name: string; info: ApprovalTxInfo | null }> = [
      { name: 'tx not found', info: null },
      { name: 'tx failed', info: { ...base, succeeded: false } },
      { name: 'wrong contract', info: { ...base, contractId: 'CWRONGCONTRACTID' } },
      { name: 'wrong function', info: { ...base, functionName: 'transfer' } },
      { name: 'wrong subscriber', info: { ...base, subscriberAddress: 'GIMPOSTER' } },
    ];
    for (const c of cases) {
      const fake = makeFakeChain({ approval: () => c.info });
      __setPirc2ChainClient(fake.client);
      try {
        const r = await verifyAllowanceApproval({ approvalTxId: 't', subscriberAddress: 'GSUB' });
        assert.equal(r.verified, false, `${c.name} must NOT verify`);
        assert.equal(r.serviceId, null, `${c.name} must not leak a service id`);
        assert.equal(r.subId, null);
      } finally {
        __setPirc2ChainClient(null);
      }
    }
  });
});

test('verifyAllowanceApproval accepts a matching subscribe() tx and returns service/sub ids', async () => {
  const fake = makeFakeChain({
    approval: () => ({
      succeeded: true,
      contractId: PIRC2_TESTNET_ENV.PIRC2_CONTRACT_ID,
      functionName: 'subscribe',
      subscriberAddress: 'GSUBOK',
      serviceId: '42',
      subId: '1001',
    }),
  });
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(PIRC2_TESTNET_ENV, async () => {
      const r = await verifyAllowanceApproval({ approvalTxId: 'tok', subscriberAddress: 'GSUBOK' });
      assert.equal(r.verified, true);
      assert.equal(r.serviceId, '42');
      assert.equal(r.subId, '1001');
    });
  } finally {
    __setPirc2ChainClient(null);
  }
});

test('revokeAllowance is an honest no-op (resolves, never throws) even when unconfigured', async () => {
  await withEnvAsync(
    { PIRC2_CONTRACT_ID: undefined, SOROBAN_RPC_URL: undefined, PIRC2_NETWORK_PASSPHRASE: undefined },
    async () => {
      await revokeAllowance('GSUB'); // must simply resolve
    },
  );
  assert.ok(true);
});

test('runBillingTick performs zero on-chain draws while GO-LIVE is OFF', async () => {
  const prior = await getGoLiveConfig();
  await updateGoLiveConfig({ goLiveEnabled: false });
  const fake = makeFakeChain();
  __setPirc2ChainClient(fake.client);
  try {
    await withEnvAsync(PIRC2_TESTNET_ENV, async () => {
      await runBillingTick();
    });
    assert.equal(fake.calls.submitProcess, 0, 'no draw may occur while the master switch is off');
  } finally {
    __setPirc2ChainClient(null);
    await updateGoLiveConfig({ goLiveEnabled: prior.goLiveEnabled });
  }
});

test('billing reconciles each subscriber from contract events, not aggregate counts', async () => {
  const prior = await getGoLiveConfig();
  await updateGoLiveConfig({ goLiveEnabled: true });

  const SERVICE = '7';
  const past = new Date(Date.now() - 60_000);
  const mk = async (addr: string) => {
    const user = await prisma.user.create({
      data: { piUserId: `pi-${crypto.randomUUID()}`, username: `u-${addr.toLowerCase()}` },
    });
    const sub = await prisma.piSubscription.create({
      data: {
        userId: user.id,
        tier: 'PREMIUM',
        status: 'ACTIVE',
        subscriberAddress: addr,
        contractId: PIRC2_TESTNET_ENV.PIRC2_CONTRACT_ID,
        onChainServiceId: SERVICE,
        approvalTxId: `appr-${crypto.randomUUID()}`,
        currency: 'PI',
        amountPerCycle: new Prisma.Decimal('1'),
        allowanceTotal: new Prisma.Decimal('12'),
        allowanceRemaining: new Prisma.Decimal('12'),
        intervalDays: 30,
        cyclesAuthorized: 12,
        cyclesBilled: 0,
        nextBillingAt: past,
      },
    });
    return { user, sub };
  };

  const charged = await mk('GAAA');
  const failed = await mk('GBBB');
  const notDue = await mk('GCCC');

  // The aggregate counts deliberately LIE (charged: 99) — only the per-subscriber
  // events are authoritative, so exactly one user (GAAA) may be granted access.
  const fake = makeFakeChain({
    process: (input) => ({
      txId: 'tx-batch',
      result: { charged: 99, failed: 99, skipped: 99, total: 3 },
      events: [
        { kind: 'charge', subscriberAddress: 'GAAA', serviceId: input.serviceId, txId: 'tx-batch' },
        { kind: 'chg_fail', subscriberAddress: 'GBBB', serviceId: input.serviceId, txId: 'tx-batch' },
      ],
    }),
  });
  __setPirc2ChainClient(fake.client);

  try {
    await withEnvAsync(PIRC2_TESTNET_ENV, async () => {
      await runBillingTick();
    });

    const [subA, subB, subC, userA, userB, userC] = await Promise.all([
      prisma.piSubscription.findUnique({ where: { id: charged.sub.id } }),
      prisma.piSubscription.findUnique({ where: { id: failed.sub.id } }),
      prisma.piSubscription.findUnique({ where: { id: notDue.sub.id } }),
      prisma.user.findUnique({ where: { id: charged.user.id } }),
      prisma.user.findUnique({ where: { id: failed.user.id } }),
      prisma.user.findUnique({ where: { id: notDue.user.id } }),
    ]);

    // GAAA: charge event => cycle advanced + access granted.
    assert.equal(subA?.status, 'ACTIVE');
    assert.equal(subA?.cyclesBilled, 1);
    assert.equal(userA?.tier, 'PREMIUM');

    // GBBB: chg_fail event => PAST_DUE, no cycle, access NOT granted.
    assert.equal(subB?.status, 'PAST_DUE');
    assert.equal(subB?.cyclesBilled, 0);
    assert.equal(userB?.tier, 'FREE');

    // GCCC: no event => not charged, not granted, backed off for retry.
    assert.equal(subC?.status, 'ACTIVE');
    assert.equal(subC?.cyclesBilled, 0);
    assert.equal(userC?.tier, 'FREE');
    assert.ok(
      subC?.nextBillingAt && subC.nextBillingAt.getTime() > Date.now(),
      'an uncharged subscriber must be rescheduled, not granted',
    );

    assert.equal(fake.calls.submitProcess, 1, 'one batched draw for the single service');
  } finally {
    for (const x of [charged, failed, notDue]) {
      await prisma.billingEvent.deleteMany({ where: { subscriptionId: x.sub.id } });
      await prisma.piSubscription.delete({ where: { id: x.sub.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: x.user.id } }).catch(() => undefined);
    }
    __setPirc2ChainClient(null);
    await updateGoLiveConfig({ goLiveEnabled: prior.goLiveEnabled });
  }
});

test.after(async () => {
  await prisma.$disconnect();
});
