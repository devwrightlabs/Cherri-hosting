/**
 * T3.1 — DomainProvider abstraction + stubs
 *
 * Proves interface conformance for PiDomainProvider and HostingerDomainProvider:
 * - Both implement every method of DomainProvider
 * - PiDomainProvider works correctly with/without inventory
 * - HostingerDomainProvider throws an honest NOT_CONFIGURED error (not a crash,
 *   not a silent fake) when HOSTINGER_API_TOKEN is absent
 * - domainProviderFor() selects the right provider by domain type
 *
 * No external network calls, no DB required.
 *
 * Run: npm test (node:test via tsx)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DomainProvider,
  DomainProviderNotConfiguredError,
} from '../services/domain/DomainProvider';
import { PiDomainProvider } from '../services/domain/PiDomainProvider';
import { HostingerDomainProvider } from '../services/domain/HostingerDomainProvider';
import { domainProviderFor, piProvider, hostingerProvider } from '../services/domain/index';

// ─── Helper ──────────────────────────────────────────────────────────────────

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ─── Interface-conformance check ──────────────────────────────────────────────

function assertImplementsDomainProvider(p: unknown): void {
  const methods: (keyof DomainProvider)[] = [
    'connectDomain',
    'listRecords',
    'upsertRecord',
    'deleteRecord',
    'provisionSsl',
    'sslStatus',
    'mapToCid',
    'removeMapping',
  ];
  for (const m of methods) {
    assert.ok(
      typeof (p as Record<string, unknown>)[m] === 'function',
      `DomainProvider interface: ${m} must be a function`,
    );
  }
}

// ─── Interface conformance ────────────────────────────────────────────────────

test('PiDomainProvider implements every DomainProvider method', () => {
  assertImplementsDomainProvider(new PiDomainProvider());
});

test('HostingerDomainProvider implements every DomainProvider method', () => {
  assertImplementsDomainProvider(new HostingerDomainProvider());
});

// ─── PiDomainProvider ─────────────────────────────────────────────────────────

test('PiDomainProvider: connectDomain throws NOT_CONFIGURED when inventory is empty', async () => {
  const p = new PiDomainProvider();
  await withEnv({ PI_DOMAIN_INVENTORY: undefined }, async () => {
    await assert.rejects(
      () => p.connectDomain('test.pi'),
      (err: unknown) => {
        assert.ok(err instanceof DomainProviderNotConfiguredError);
        assert.strictEqual((err as DomainProviderNotConfiguredError).provider, 'pi');
        return true;
      },
    );
  });
});

test('PiDomainProvider: connectDomain assigns from inventory when available', async () => {
  const p = new PiDomainProvider();
  p.reset();
  const result = await withEnv(
    { PI_DOMAIN_INVENTORY: 'mysite.pi,other.pi' },
    () => p.connectDomain(''),
  );
  assert.ok(result.domain.endsWith('.pi'));
  assert.ok(Array.isArray(result.pendingSteps) && result.pendingSteps.length > 0);
  p.reset();
});

test('PiDomainProvider: connectDomain assigns a specific requested domain', async () => {
  const p = new PiDomainProvider();
  p.reset();
  const result = await withEnv(
    { PI_DOMAIN_INVENTORY: 'mysite.pi,other.pi' },
    () => p.connectDomain('mysite.pi'),
  );
  assert.strictEqual(result.domain, 'mysite.pi');
  p.reset();
});

test('PiDomainProvider: mapToCid stores the mapping and returns DomainMapping shape', async () => {
  const p = new PiDomainProvider();
  p.reset();
  // CID must pass isValidCid: /^[A-Za-z0-9]{10,}$/
  const cid = 'QmTestCidAbcDef1234567890';
  const mapping = await p.mapToCid('mysite.pi', cid);
  assert.strictEqual(mapping.domain, 'mysite.pi');
  assert.strictEqual(mapping.cid, cid);
  assert.ok(mapping.gatewayUrl.includes(cid));
  assert.strictEqual(mapping.dnslink, `dnslink=/ipfs/${cid}`);
  // Verify internal state
  assert.strictEqual(p.getCidForDomain('mysite.pi'), cid);
  p.reset();
});

test('PiDomainProvider: removeMapping clears the CID mapping', async () => {
  const p = new PiDomainProvider();
  p.reset();
  await p.mapToCid('mysite.pi', 'QmSomeCid1234567890ABCDEF');
  await p.removeMapping('mysite.pi');
  assert.strictEqual(p.getCidForDomain('mysite.pi'), undefined);
  p.reset();
});

test('PiDomainProvider: listRecords returns DNSLink TXT when mapped', async () => {
  const p = new PiDomainProvider();
  p.reset();
  await p.mapToCid('mysite.pi', 'QmTestCid1234567890ABCDEF');
  const records = await p.listRecords('mysite.pi');
  assert.ok(records.length > 0);
  const dnslink = records.find((r) => r.type === 'TXT' && r.name === '_dnslink');
  assert.ok(dnslink, 'Should have a _dnslink TXT record');
  assert.ok(dnslink!.content.includes('QmTestCid'));
  p.reset();
});

test('PiDomainProvider: listRecords returns empty when no CID mapped', async () => {
  const p = new PiDomainProvider();
  p.reset();
  const records = await p.listRecords('unmapped.pi');
  assert.deepStrictEqual(records, []);
  p.reset();
});

test('PiDomainProvider: sslStatus reports ACTIVE (Pi Browser handles HTTPS natively)', async () => {
  const p = new PiDomainProvider();
  const status = await p.sslStatus('any.pi');
  assert.strictEqual(status.state, 'ACTIVE');
  assert.ok(status.detail?.includes('Pi Browser'));
});

test('PiDomainProvider: provisionSsl is a no-op (no throws, no network)', async () => {
  const p = new PiDomainProvider();
  // Should resolve cleanly — Pi Browser manages HTTPS natively.
  await assert.doesNotReject(() => p.provisionSsl('any.pi'));
});

// ─── HostingerDomainProvider ──────────────────────────────────────────────────

test('HostingerDomainProvider: connectDomain throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.connectDomain('example.com'),
      (err: unknown) => {
        assert.ok(err instanceof DomainProviderNotConfiguredError);
        assert.strictEqual((err as DomainProviderNotConfiguredError).provider, 'hostinger');
        assert.ok((err as Error).message.includes('HOSTINGER_API_TOKEN'));
        return true;
      },
    );
  });
});

test('HostingerDomainProvider: listRecords throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.listRecords('example.com'),
      (err: unknown) => err instanceof DomainProviderNotConfiguredError,
    );
  });
});

test('HostingerDomainProvider: upsertRecord throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.upsertRecord('example.com', { type: 'A', name: '@', content: '1.2.3.4' }),
      (err: unknown) => err instanceof DomainProviderNotConfiguredError,
    );
  });
});

test('HostingerDomainProvider: deleteRecord throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.deleteRecord('example.com', { type: 'A', name: '@', content: '1.2.3.4' }),
      (err: unknown) => err instanceof DomainProviderNotConfiguredError,
    );
  });
});

test('HostingerDomainProvider: provisionSsl throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.provisionSsl('example.com'),
      (err: unknown) => err instanceof DomainProviderNotConfiguredError,
    );
  });
});

test('HostingerDomainProvider: sslStatus throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.sslStatus('example.com'),
      (err: unknown) => err instanceof DomainProviderNotConfiguredError,
    );
  });
});

test('HostingerDomainProvider: mapToCid throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.mapToCid('example.com', 'QmSomeCid'),
      (err: unknown) => err instanceof DomainProviderNotConfiguredError,
    );
  });
});

test('HostingerDomainProvider: removeMapping throws NOT_CONFIGURED when token absent', async () => {
  const p = new HostingerDomainProvider();
  await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
    await assert.rejects(
      () => p.removeMapping('example.com'),
      (err: unknown) => err instanceof DomainProviderNotConfiguredError,
    );
  });
});

test('HostingerDomainProvider: all errors are DomainProviderNotConfiguredError (not generic crash)', async () => {
  const p = new HostingerDomainProvider();
  const methods: Array<() => Promise<unknown>> = [
    () => p.connectDomain('example.com'),
    () => p.listRecords('example.com'),
    () => p.upsertRecord('example.com', { type: 'A', name: '@', content: '1.2.3.4' }),
    () => p.deleteRecord('example.com', { type: 'A', name: '@', content: '1.2.3.4' }),
    () => p.provisionSsl('example.com'),
    () => p.sslStatus('example.com'),
    () => p.mapToCid('example.com', 'QmCid'),
    () => p.removeMapping('example.com'),
  ];
  for (const m of methods) {
    await withEnv({ HOSTINGER_API_TOKEN: undefined }, async () => {
      await assert.rejects(
        m,
        (err: unknown) => {
          // Must be DomainProviderNotConfiguredError, not some generic Error or TypeError
          assert.ok(
            err instanceof DomainProviderNotConfiguredError,
            `Expected DomainProviderNotConfiguredError, got: ${String(err)}`,
          );
          return true;
        },
      );
    });
  }
});

// ─── Provider selector ────────────────────────────────────────────────────────

test('domainProviderFor: .pi domains → PiDomainProvider', () => {
  const p = domainProviderFor('mysite.pi');
  assert.ok(p instanceof PiDomainProvider);
});

test('domainProviderFor: .com domains → HostingerDomainProvider', () => {
  const p = domainProviderFor('example.com');
  assert.ok(p instanceof HostingerDomainProvider);
});

test('domainProviderFor: .io domains → HostingerDomainProvider', () => {
  const p = domainProviderFor('myapp.io');
  assert.ok(p instanceof HostingerDomainProvider);
});

test('domainProviderFor: domain with uppercase → still .pi route (case-insensitive)', () => {
  const p = domainProviderFor('MyApp.PI');
  assert.ok(p instanceof PiDomainProvider);
});

test('piProvider and hostingerProvider are the shared singletons', () => {
  assert.ok(piProvider instanceof PiDomainProvider);
  assert.ok(hostingerProvider instanceof HostingerDomainProvider);
  // domainProviderFor reuses the same singletons
  assert.strictEqual(domainProviderFor('test.pi'), piProvider);
  assert.strictEqual(domainProviderFor('test.com'), hostingerProvider);
});
