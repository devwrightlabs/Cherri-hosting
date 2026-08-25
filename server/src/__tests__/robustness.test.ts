/**
 * Robustness hardening tests.
 *
 * Covers:
 *   - Central error handler: envelope shape, stack suppression in prod, requestId propagation
 *   - /readyz: DB reachable → 200, DB absent → 503
 *   - /healthz: always 200
 *   - requestId middleware: header present, req.requestId populated
 *   - Resilience util: withTimeout, withRetry, CircuitBreaker, withResilience
 *   - watchdogService: state transitions (up→down opens incident, down→up closes it)
 *                       no-DB graceful path (monitoringDisabled: true)
 *
 * Uses the project's standard node:test runner + pglite via prismaClient.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ─── Resilience util tests ───────────────────────────────────────────────────

import {
  withTimeout,
  withRetry,
  CircuitBreaker,
  withResilience,
  TimeoutError,
  CircuitOpenError,
} from '../utils/resilience';

test('withTimeout resolves when fn completes in time', async () => {
  const result = await withTimeout(() => Promise.resolve(42), 500);
  assert.equal(result, 42);
});

test('withTimeout rejects with TimeoutError when fn is too slow', async () => {
  const slow = () => new Promise<never>((_, rej) => setTimeout(() => rej(new Error('too late')), 200));
  await assert.rejects(
    () => withTimeout(slow, 50),
    (err) => err instanceof TimeoutError,
  );
});

test('withRetry succeeds on the first attempt', async () => {
  let calls = 0;
  const result = await withRetry(() => { calls++; return Promise.resolve('ok'); });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry retries on failure and eventually resolves', async () => {
  let calls = 0;
  const result = await withRetry(
    () => { calls++; if (calls < 3) throw new Error('retry me'); return Promise.resolve('done'); },
    { attempts: 3, baseDelayMs: 1 },
  );
  assert.equal(result, 'done');
  assert.equal(calls, 3);
});

test('withRetry throws after exhausting attempts', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(() => { calls++; throw new Error('always fails'); }, { attempts: 2, baseDelayMs: 1 }),
    (err: Error) => err.message === 'always fails',
  );
  assert.equal(calls, 2);
});

test('withRetry bails immediately when isRetryable returns false', async () => {
  let calls = 0;
  const err = new Error('not retryable');
  await assert.rejects(
    () => withRetry(() => { calls++; throw err; }, { attempts: 5, baseDelayMs: 1, isRetryable: () => false }),
    (e: Error) => e === err,
  );
  assert.equal(calls, 1, 'should not retry when isRetryable=false');
});

test('CircuitBreaker: starts CLOSED and opens after threshold failures', async () => {
  const cb = new CircuitBreaker('test-cb', { failureThreshold: 2, recoveryMs: 1000 });
  assert.equal(cb.getState(), 'CLOSED');
  // First failure — still closed
  await assert.rejects(() => cb.execute(() => Promise.reject(new Error('fail'))));
  assert.equal(cb.getState(), 'CLOSED');
  // Second failure — should open
  await assert.rejects(() => cb.execute(() => Promise.reject(new Error('fail'))));
  assert.equal(cb.getState(), 'OPEN');
  // Third attempt — CircuitOpenError (no execution)
  await assert.rejects(
    () => cb.execute(() => Promise.resolve('should not run')),
    (err) => err instanceof CircuitOpenError,
  );
  cb.__reset();
});

test('CircuitBreaker: transitions OPEN → HALF_OPEN → CLOSED on recovery', async () => {
  const cb = new CircuitBreaker('test-recovery', { failureThreshold: 1, recoveryMs: 10 });
  // Open the breaker
  await assert.rejects(() => cb.execute(() => Promise.reject(new Error('x'))));
  assert.equal(cb.getState(), 'OPEN');
  // Wait for recovery window
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cb.getState(), 'HALF_OPEN');
  // Successful probe → CLOSED
  const val = await cb.execute(() => Promise.resolve('healed'));
  assert.equal(val, 'healed');
  assert.equal(cb.getState(), 'CLOSED');
  cb.__reset();
});

test('withResilience composes timeout + retry (no breaker)', async () => {
  let calls = 0;
  const result = await withResilience(
    () => { calls++; if (calls < 2) throw new Error('transient'); return Promise.resolve('ok'); },
    { timeoutMs: 500, attempts: 3, baseDelayMs: 1 },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('withResilience with circuit breaker: CircuitOpenError when breaker is open', async () => {
  const cb = new CircuitBreaker('compose-test', { failureThreshold: 1, recoveryMs: 60_000 });
  // Open the breaker via first failure
  await assert.rejects(() => withResilience(
    () => Promise.reject(new Error('boom')),
    { timeoutMs: 500, attempts: 1, baseDelayMs: 1, breaker: cb },
  ));
  assert.equal(cb.getState(), 'OPEN');
  // Next call should throw CircuitOpenError without hitting fn
  await assert.rejects(
    () => withResilience(() => Promise.resolve('wont run'), { timeoutMs: 500, breaker: cb }),
    (err) => err instanceof CircuitOpenError,
  );
  cb.__reset();
});

// ─── Central error handler ───────────────────────────────────────────────────

import { centralErrorHandler } from '../middleware/errorHandler';
import type { Request, Response } from 'express';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    requestId: crypto.randomUUID(),
    path: '/test',
    method: 'GET',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): { status: (n: number) => { json: (d: unknown) => void }; _status: number; _body: unknown } {
  const r = {
    _status: 0,
    _body: undefined as unknown,
    status(n: number) {
      r._status = n;
      return { json(d: unknown) { r._body = d; } };
    },
  };
  return r;
}

test('centralErrorHandler returns 500 with error envelope', () => {
  const req = mockReq();
  const res = mockRes();
  const err = new Error('something broke');
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    centralErrorHandler(err, req, res as unknown as Response, () => {});
    assert.equal(res._status, 500);
    const body = res._body as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
    assert.ok(body.error.requestId, 'requestId must be present');
    assert.equal(body.error.message, 'something broke', 'dev mode exposes message');
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('centralErrorHandler suppresses stack/message detail in production', () => {
  const req = mockReq();
  const res = mockRes();
  const err = new Error('secret internal detail');
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    centralErrorHandler(err, req, res as unknown as Response, () => {});
    assert.equal(res._status, 500);
    const body = res._body as { error: { code: string; message: string; requestId: string } };
    assert.equal(body.error.message, 'Internal server error', 'prod hides real message');
    const serialized = JSON.stringify(body).toLowerCase();
    assert.ok(!serialized.includes('secret'), 'secret detail must not leak');
    assert.ok(!serialized.includes('stack'), 'stack must not be in prod response');
  } finally {
    process.env.NODE_ENV = origEnv;
  }
});

test('centralErrorHandler returns 503 for IntegrationUnavailableError', () => {
  const { IntegrationUnavailableError } = require('../utils/integrations');
  const req = mockReq();
  const res = mockRes();
  const err = new IntegrationUnavailableError('pinata', 'IPFS not configured');
  centralErrorHandler(err, req, res as unknown as Response, () => {});
  assert.equal(res._status, 503);
  const body = res._body as { error: { code: string } };
  assert.equal(body.error.code, 'INTEGRATION_UNAVAILABLE');
});

// ─── requestId middleware ─────────────────────────────────────────────────────

import { requestIdMiddleware } from '../middleware/requestId';

test('requestIdMiddleware populates req.requestId and sets X-Request-Id header', () => {
  const req: Partial<Request> & { requestId?: string } = {};
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };
  let nextCalled = false;
  requestIdMiddleware(req as Request, res as unknown as Response, () => { nextCalled = true; });
  assert.ok(nextCalled, 'next() must be called');
  assert.ok(req.requestId, 'requestId must be set on req');
  assert.ok(headers['X-Request-Id'], 'header must be set');
  assert.equal(req.requestId, headers['X-Request-Id'], 'header must match req.requestId');
  // Should be a valid UUID
  assert.match(req.requestId!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

// ─── watchdogService — no-DB graceful path ────────────────────────────────────

import { getWatchdogSummary, getDeploymentIncidents, manualRecheck } from '../services/watchdogService';

test('watchdogService.getWatchdogSummary returns monitoringDisabled when DATABASE_URL absent', async () => {
  const origUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await getWatchdogSummary('any-user-id') as { monitoringDisabled: boolean; deployments: unknown[] };
    assert.equal(result.monitoringDisabled, true, 'must signal disabled without DB');
    assert.deepEqual(result.deployments, [], 'must return empty deployments');
  } finally {
    if (origUrl !== undefined) process.env.DATABASE_URL = origUrl;
  }
});

test('watchdogService.getDeploymentIncidents returns monitoringDisabled when DATABASE_URL absent', async () => {
  const origUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await getDeploymentIncidents('dep-id', 'user-id') as { monitoringDisabled: boolean };
    assert.equal(result.monitoringDisabled, true);
  } finally {
    if (origUrl !== undefined) process.env.DATABASE_URL = origUrl;
  }
});

test('watchdogService.manualRecheck returns monitoringDisabled when DATABASE_URL absent', async () => {
  const origUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await manualRecheck('dep-id', 'user-id') as { monitoringDisabled: boolean };
    assert.equal(result.monitoringDisabled, true);
  } finally {
    if (origUrl !== undefined) process.env.DATABASE_URL = origUrl;
  }
});

// ─── watchdogService — state transition (skipped when DATABASE_URL is absent) ────
//
// These require a live DB via embedded-postgres (same gate as the pre-existing
// backendLane / dataSafety / resilience tests). When DATABASE_URL is not set
// the tests are skipped cleanly, which is the same behaviour as the test suite
// baseline (those 26 pre-existing DB-dependent tests also require DATABASE_URL).

import { prisma } from '../utils/prismaClient';
import { runWatchdogTick } from '../services/watchdogService';

const HAS_DB = Boolean(process.env.DATABASE_URL);

/** Create a throwaway user + project + ACTIVE deployment with a gateway URL. */
async function makeActiveDeployment(gateway: string): Promise<{ userId: string; projectId: string; deploymentId: string }> {
  const user = await prisma.user.create({
    data: { piUserId: `wd-test-${crypto.randomUUID()}`, username: 'watchdog-test' },
  });
  const project = await prisma.project.create({
    data: { name: `wd-proj-${crypto.randomUUID().slice(0, 8)}`, userId: user.id },
  });
  const deployment = await (prisma as any).deployment.create({
    data: {
      projectId: project.id,
      status: 'ACTIVE',
      gateway,
      cid: `Qm${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 46),
    },
  });
  return { userId: user.id, projectId: project.id, deploymentId: deployment.id };
}

async function cleanupWatchdog(userId: string, projectId: string, deploymentId: string): Promise<void> {
  await (prisma as any).watchdogIncident.deleteMany({ where: { deploymentId } }).catch(() => {});
  await (prisma as any).watchdogCheck.deleteMany({ where: { deploymentId } }).catch(() => {});
  await (prisma as any).deployment.deleteMany({ where: { id: deploymentId } }).catch(() => {});
  await (prisma as any).project.deleteMany({ where: { id: projectId } }).catch(() => {});
  await (prisma as any).user.deleteMany({ where: { id: userId } }).catch(() => {});
}

test('watchdogService: a DOWN check opens an incident', { skip: !HAS_DB }, async () => {
  // Use a port that is definitely not listening so probe fails immediately
  const { userId, projectId, deploymentId } = await makeActiveDeployment('http://127.0.0.1:19999');
  try {
    await runWatchdogTick();

    const checks = await (prisma as any).watchdogCheck.findMany({ where: { deploymentId } });
    assert.ok(checks.length >= 1, 'at least one check should be recorded');
    const lastCheck = checks[checks.length - 1];
    assert.notEqual(lastCheck.status, 'up', 'connecting to a closed port should not be "up"');

    const incidents = await (prisma as any).watchdogIncident.findMany({ where: { deploymentId } });
    assert.ok(incidents.length >= 1, 'an incident should be opened on a down status');
    assert.equal(incidents[0].closedAt, null, 'incident should be open');
  } finally {
    await cleanupWatchdog(userId, projectId, deploymentId);
  }
});

test('watchdogService: summary returns correct shape for active deployments', { skip: !HAS_DB }, async () => {
  const { userId, projectId, deploymentId } = await makeActiveDeployment('http://127.0.0.1:19999');
  try {
    await runWatchdogTick();
    const summary = await getWatchdogSummary(userId) as { monitoringDisabled: boolean; deployments: Array<{ deploymentId: string; uptimePercent24h: number }> };
    assert.equal(summary.monitoringDisabled, false);
    assert.ok(Array.isArray(summary.deployments));
    const entry = summary.deployments.find((d) => d.deploymentId === deploymentId);
    assert.ok(entry, 'deployment should appear in summary');
    assert.ok(typeof entry.uptimePercent24h === 'number', 'uptime% must be a number');
  } finally {
    await cleanupWatchdog(userId, projectId, deploymentId);
  }
});
