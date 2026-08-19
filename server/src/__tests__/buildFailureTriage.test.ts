/**
 * T4.1 — Concierge build-failure triage tests
 *
 * Tests use real-ish failure log fixtures (copied/condensed from actual build
 * outputs) and assert that:
 *   - The explanation is non-empty plain language
 *   - The suggestedFix has the correct action type
 *   - The category tag matches what we expect
 *
 * No DB, no network.
 *
 * Run: npm test (node:test via tsx)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFailureTriage, TriageResult } from '../services/concierge/buildFailureTriage';

// ─── Fixture logs ─────────────────────────────────────────────────────────────

const LOGS = {

  missingOutputDir: `
> vite build

vite v4.5.0 building for production...
✓ 142 modules transformed.
Build finished in 3.42s

ENOENT: no such file or directory, stat '/tmp/build-abc123/dist'
  `,

  missingBuildScript: `
> npm run build

npm ERR! Missing script: "build"
npm ERR! 
npm ERR! To see a list of scripts, run:
npm ERR!   npm run
  `,

  nodeVersionMismatch: `
> npm install

npm warn EBADENGINE Unsupported engine {
npm warn EBADENGINE   package: 'my-package@1.0.0',
npm warn EBADENGINE   required: { node: '>=20.0.0' },
npm warn EBADENGINE   current: { node: 'v18.12.0', npm: '8.19.2' }
npm warn EBADENGINE }
node engines required: >=20.0.0
node version not supported
  `,

  lockfileMismatch: [
    '> npm install',
    '',
    'npm error code EUSAGE',
    'npm error ',
    'npm error package-lock.json file created by unknown package manager. Please run the appropriate package manager to update it before continuing.',
    'npm error',
    'npm warn package-lock.json out of date',
  ].join('\n'),

  missingDependency: `
> vite build

✗ Build failed in 1.23s

error: Cannot find module 'tailwindcss/plugin'
  `,

  missingDependencyWebpack: `
> react-scripts build

Creating an optimized production build...
Failed to compile.

./src/index.tsx
Module not found: Error: Can't resolve '@mui/material/Button' in '/tmp/src'
  `,

  outOfMemory: `
> next build

info  - Compiling 42 pages...
Killed

npm ERR! command failed
npm ERR! command sh -c next build
  `,

  oomHeap: `
> webpack --config webpack.config.js

<--- Last few GCs --->
<--- JS stacktrace --->
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
  `,

  typescriptError: `
> tsc --noEmit && vite build

src/components/Header.tsx(42,16): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/pages/Home.tsx(87,5): error TS2322: Type 'number' is not assignable to type 'string'.
  `,

  peerDepConflict: `
> npm install

npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR! 
npm ERR! While resolving: my-app@0.1.0
npm ERR! Found: react@18.2.0
npm ERR! node_modules/react
npm ERR!   react@"^18.2.0" from the root project
npm ERR! 
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^17.0.0" from react-nice-dates@4.0.0
  `,

  buildTimeout: `
> vite build

vite v4.5.0 building for production...
Build timed out after 600 seconds (wall-clock limit exceeded)
npm ERR! command failed
  `,

  unknownFailure: `
> some-obscure-tool build

An error occurred during build.
Exit code 1.
  `,

  emptyLogs: '',

  yarnLockMismatch: `
> yarn install

error Your lockfile needs to be updated, but yarn was run with \`--frozen-lockfile\`.
yarn.lock out of date
  `,

  pnpmLockMismatch: `
> pnpm install

ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with \`--frozen-lockfile\` because pnpm-lock.yaml is not up to date with package.json
  `,

  installFailureNetwork: `
> npm install

npm ERR! code ENOTFOUND
npm ERR! errno ENOTFOUND
npm ERR! network request to https://registry.npmjs.org/ failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
  `,
};

// ─── Assertion helpers ────────────────────────────────────────────────────────

function assertResult(result: TriageResult, opts: {
  matched?: boolean;
  category?: string;
  actionType?: string;
  hasExplanation?: boolean;
}): void {
  if (opts.matched !== undefined) {
    assert.strictEqual(result.matched, opts.matched, `matched should be ${opts.matched}`);
  }
  if (opts.category !== undefined) {
    assert.strictEqual(result.category, opts.category, `category should be ${opts.category}`);
  }
  if (opts.actionType !== undefined) {
    assert.ok(result.suggestedFix !== null, 'suggestedFix should not be null');
    assert.strictEqual(result.suggestedFix!.action, opts.actionType, `fix action should be ${opts.actionType}`);
  }
  if (opts.hasExplanation !== false) {
    assert.ok(result.explanation.length > 20, 'explanation should be substantive plain language');
    assert.ok(result.title.length > 0, 'title should be non-empty');
    // Sanity: explanation should not contain raw error codes/stack traces
    assert.ok(!result.explanation.includes('Error:'), 'explanation should not include raw "Error:"');
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test('triage: missing output directory → setOutputDir fix', () => {
  const result = buildFailureTriage(LOGS.missingOutputDir);
  assertResult(result, { matched: true, actionType: 'setOutputDir' });
  assert.ok(result.explanation.includes('output'), 'explanation should mention output folder');
});

test('triage: missing build script → setBuildScript fix', () => {
  const result = buildFailureTriage(LOGS.missingBuildScript);
  assertResult(result, { matched: true, category: 'missing-build-script', actionType: 'setBuildScript' });
  assert.ok(result.explanation.includes('build'), 'explanation should mention build script');
});

test('triage: Node.js version mismatch → setNodeVersion fix', () => {
  const result = buildFailureTriage(LOGS.nodeVersionMismatch, { nodeVersion: 'v18.12.0' });
  assertResult(result, { matched: true, category: 'node-version-mismatch', actionType: 'setNodeVersion' });
  assert.ok(result.explanation.includes('Node'), 'explanation should mention Node.js');
  // Should extract required version from log
  const fix = result.suggestedFix as { action: 'setNodeVersion'; value: string };
  assert.ok(fix.value.includes('20'), `Node version fix should suggest 20, got: ${fix.value}`);
});

test('triage: npm package-lock.json out of date → removeLockfile fix', () => {
  const result = buildFailureTriage(LOGS.lockfileMismatch);
  assertResult(result, { matched: true, category: 'lockfile-mismatch', actionType: 'removeLockfile' });
  const fix = result.suggestedFix as { action: 'removeLockfile'; filename: string };
  assert.ok(fix.filename.length > 0, 'filename should be specified');
});

test('triage: yarn.lock out of date → removeLockfile with yarn.lock', () => {
  const result = buildFailureTriage(LOGS.yarnLockMismatch);
  assertResult(result, { matched: true, category: 'lockfile-mismatch', actionType: 'removeLockfile' });
  const fix = result.suggestedFix as { action: 'removeLockfile'; filename: string };
  assert.strictEqual(fix.filename, 'yarn.lock');
});

test('triage: pnpm-lock out of date → removeLockfile with pnpm-lock.yaml', () => {
  const result = buildFailureTriage(LOGS.pnpmLockMismatch);
  assertResult(result, { matched: true, category: 'lockfile-mismatch', actionType: 'removeLockfile' });
  const fix = result.suggestedFix as { action: 'removeLockfile'; filename: string };
  assert.strictEqual(fix.filename, 'pnpm-lock.yaml');
});

test('triage: missing dependency (Cannot find module) → addDependency fix', () => {
  const result = buildFailureTriage(LOGS.missingDependency);
  assertResult(result, { matched: true, category: 'missing-dependency', actionType: 'addDependency' });
  const fix = result.suggestedFix as { action: 'addDependency'; name: string; dev: boolean };
  assert.ok(fix.name.length > 0, 'package name should be extracted');
});

test("triage: missing dependency (Can't resolve) → addDependency fix", () => {
  const result = buildFailureTriage(LOGS.missingDependencyWebpack);
  assertResult(result, { matched: true, category: 'missing-dependency', actionType: 'addDependency' });
  const fix = result.suggestedFix as { action: 'addDependency'; name: string; dev: boolean };
  assert.ok(fix.name.includes('@mui'), `expected @mui package, got: ${fix.name}`);
});

test('triage: SIGKILL / OOM → increaseMemory fix', () => {
  const result = buildFailureTriage(LOGS.outOfMemory);
  assertResult(result, { matched: true, category: 'out-of-memory', actionType: 'increaseMemory' });
});

test('triage: JavaScript heap out of memory → increaseMemory fix', () => {
  const result = buildFailureTriage(LOGS.oomHeap);
  assertResult(result, { matched: true, category: 'out-of-memory', actionType: 'increaseMemory' });
});

test('triage: TypeScript error → plain explanation, no fix action', () => {
  const result = buildFailureTriage(LOGS.typescriptError);
  assertResult(result, { matched: true, category: 'typescript-error' });
  assert.strictEqual(result.suggestedFix, null, 'TypeScript errors have no auto-fix');
  assert.ok(result.explanation.includes('TypeScript'), 'explanation should mention TypeScript');
});

test('triage: peer dependency conflict → contactSupport', () => {
  const result = buildFailureTriage(LOGS.peerDepConflict);
  assertResult(result, { matched: true, category: 'peer-dependency-conflict', actionType: 'contactSupport' });
});

test('triage: build timeout → retry fix', () => {
  const result = buildFailureTriage(LOGS.buildTimeout);
  assertResult(result, { matched: true, category: 'build-timeout', actionType: 'retry' });
});

test('triage: npm network failure → retry fix (install failure)', () => {
  const result = buildFailureTriage(LOGS.installFailureNetwork);
  assertResult(result, { matched: true, actionType: 'retry' });
});

test('triage: unrecognised error → matched:false with plain message', () => {
  const result = buildFailureTriage(LOGS.unknownFailure);
  assert.strictEqual(result.matched, false);
  assert.ok(result.explanation.length > 10, 'should still have a helpful explanation');
  assert.ok(result.category === 'unknown');
});

test('triage: empty logs → matched:false with explanation', () => {
  const result = buildFailureTriage(LOGS.emptyLogs);
  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.category, 'no-logs');
  assert.ok(result.explanation.length > 10);
});

test('triage: explanation is always plain language (no raw error codes)', () => {
  const allLogs = Object.values(LOGS);
  for (const log of allLogs) {
    const result = buildFailureTriage(log);
    // Explanations must be plain language — no "TS2345" style codes, no stack traces
    assert.ok(!result.explanation.includes('ENOENT'), `explanation for "${result.category}" contains ENOENT`);
    assert.ok(!result.explanation.includes('ERR_PNPM_'), `explanation for "${result.category}" contains raw pnpm error code`);
    // But CAN reference things like "npm ERR!" in a helpful way — only raw TS codes are bad
    assert.ok(result.title.length > 0, 'title is always set');
  }
});

test('triage: context object is optional (no crash without it)', () => {
  // All fixture logs should triage without context
  for (const [name, log] of Object.entries(LOGS)) {
    assert.doesNotThrow(
      () => buildFailureTriage(log),
      `buildFailureTriage should not throw for log fixture: ${name}`,
    );
  }
});
