/**
 * Staging store — TTL-edge pin retry semantics.
 *
 * A stage that is mid-pin must survive TTL expiry (both the periodic sweep and
 * getStage/claimStage), and releaseStage after a failed pin must grant a grace
 * window so the retry is honestly possible. Genuinely expired NON-pinning
 * stages must still 404.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStage,
  getStage,
  claimStage,
  releaseStage,
  deleteStage,
  mutateStage,
  sweepExpiredStages,
} from '../services/stagingStore';

const USER = 'user-1';

function makeStage() {
  return createStage({
    userId: USER,
    projectId: 'proj-1',
    projectName: 'proj',
    rootPrefix: '',
    entryPoint: 'index.html',
    files: [
      { path: 'index.html', buffer: Buffer.from('<html></html>'), mimeType: 'text/html' },
    ],
    totalBytes: 13,
  });
}

test('expired non-pinning stage returns an honest not-found', () => {
  const s = makeStage();
  s.expiresAt = Date.now() - 1;
  assert.equal(getStage(s.id), null);
  const claim = claimStage(s.id, USER);
  assert.deepEqual(claim, { ok: false, reason: 'not_found' });
});

test('mid-pin stage survives TTL expiry and release grants a retry window', () => {
  const s = makeStage();
  const claim = claimStage(s.id, USER);
  assert.equal(claim.ok, true);

  // TTL passes while the pin is in flight.
  s.expiresAt = Date.now() - 1;

  // Still visible while pinning — not expired out from under the pin.
  assert.ok(getStage(s.id), 'mid-pin stage must remain retrievable past TTL');

  // Pin fails → release. The stage must be claimable again for a retry.
  releaseStage(s.id);
  const again = getStage(s.id);
  assert.ok(again, 'released stage must remain available for retry');
  assert.ok(again!.expiresAt > Date.now(), 'release must grant a grace window');

  const retry = claimStage(s.id, USER);
  assert.equal(retry.ok, true, 'retry claim after TTL-edge failure must succeed');

  deleteStage(s.id);
});

test('sweep removes expired non-pinning stages, which then 404 honestly', () => {
  const s = makeStage();
  s.expiresAt = Date.now() - 1;
  sweepExpiredStages();
  assert.equal(getStage(s.id), null, 'swept stage must not be retrievable');
  assert.deepEqual(claimStage(s.id, USER), { ok: false, reason: 'not_found' });
});

test('sweep keeps an expired stage that is mid-pin, and it stays releasable', () => {
  const s = makeStage();
  assert.equal(claimStage(s.id, USER).ok, true);
  s.expiresAt = Date.now() - 1;

  sweepExpiredStages();

  // The in-flight pin's stage must survive the sweep.
  assert.ok(getStage(s.id), 'expired mid-pin stage must survive the sweep');

  // Pin fails → releaseStage must still find the stage and allow a retry.
  releaseStage(s.id);
  const retry = claimStage(s.id, USER);
  assert.equal(retry.ok, true, 'retry after sweep + failed pin must succeed');

  // Once released and past its (grace-extended) TTL, the sweep removes it.
  const again = getStage(s.id);
  assert.ok(again);
  releaseStage(s.id);
  again!.expiresAt = Date.now() - 1;
  sweepExpiredStages();
  assert.equal(getStage(s.id), null, 'released expired stage is swept honestly');
});

test('sweep does not touch unexpired stages', () => {
  const s = makeStage();
  sweepExpiredStages();
  assert.ok(getStage(s.id), 'live stage must survive the sweep');
  deleteStage(s.id);
});

test('double-claim is rejected while a pin is in flight', () => {
  const s = makeStage();
  assert.equal(claimStage(s.id, USER).ok, true);
  assert.deepEqual(claimStage(s.id, USER), { ok: false, reason: 'pinning' });
  deleteStage(s.id);
});

test('mutateStage is rejected while a pin is in flight, succeeds after release', () => {
  const s = makeStage();
  assert.equal(claimStage(s.id, USER).ok, true);

  // Mid-pin: mutation must be refused so the pin only sees quota-checked files.
  const denied = mutateStage(s.id, USER, (stage) => {
    stage.files.push({
      path: 'extra-file.txt',
      buffer: Buffer.from('should-not-be-added'),
      mimeType: 'text/plain',
    });
  });
  assert.deepEqual(denied, { ok: false, reason: 'pinning' });
  assert.equal(s.files.length, 1, 'mid-pin mutation must not touch the files');
  assert.equal(s.totalBytes, 13, 'mid-pin mutation must not touch totalBytes');

  // Pin fails → release → mutation is allowed again.
  releaseStage(s.id);
  const allowed = mutateStage(s.id, USER, (stage) => {
    stage.files.push({
      path: 'extra-file.txt',
      buffer: Buffer.from('0123456789'),
      mimeType: 'text/plain',
    });
  });
  assert.equal(allowed.ok, true, 'mutation after release must succeed');
  deleteStage(s.id);
});

test('mutateStage recomputes totalBytes after a mutation', () => {
  const s = makeStage();
  const result = mutateStage(s.id, USER, (stage) => {
    stage.files.push({
      path: 'extra.txt',
      buffer: Buffer.from('12345'),
      mimeType: 'text/plain',
    });
  });
  assert.equal(result.ok, true);
  assert.equal(s.totalBytes, 18, 'totalBytes must equal sum of file buffers after mutation');

  // Replacing a file's contents also recomputes.
  mutateStage(s.id, USER, (stage) => {
    stage.files = stage.files.filter((f) => f.path !== 'extra.txt');
  });
  assert.equal(s.totalBytes, 13, 'totalBytes must shrink when files are removed');
  deleteStage(s.id);
});

test('mutateStage refuses the wrong user and expired stages honestly', () => {
  const s = makeStage();
  assert.deepEqual(
    mutateStage(s.id, 'someone-else', () => {}),
    { ok: false, reason: 'not_found' },
    'wrong owner must get not_found, not a hint the stage exists',
  );
  s.expiresAt = Date.now() - 1;
  assert.deepEqual(mutateStage(s.id, USER, () => {}), { ok: false, reason: 'not_found' });
});
