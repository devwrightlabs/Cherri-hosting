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

test('double-claim is rejected while a pin is in flight', () => {
  const s = makeStage();
  assert.equal(claimStage(s.id, USER).ok, true);
  assert.deepEqual(claimStage(s.id, USER), { ok: false, reason: 'pinning' });
  deleteStage(s.id);
});
