/**
 * T2.1 — AUP attestation gate tests
 *
 * Verifies:
 * - Unattested deploy is refused with a plain-language error
 * - Deploy attested to stale version is refused
 * - Deploy attested to current version passes
 * - validateAttestationPayload validates correctly
 * - buildAttestationData stamps the current version
 *
 * No DB, no network.  All tests are pure unit tests.
 *
 * Run: npm test (node:test via tsx)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  requireAttestation,
  validateAttestationPayload,
  buildAttestationData,
  isAttestationCurrent,
  AttestationRequiredError,
  DeploymentAttestation,
} from '../services/attestation';
import { CURRENT_AUP_VERSION } from '../utils/constants';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeDeployment(overrides: Partial<DeploymentAttestation> = {}): DeploymentAttestation {
  return {
    id: 'deploy-test-001',
    attestationAcceptedAt: null,
    attestedTermsVersion: null,
    ...overrides,
  };
}

// ─── requireAttestation gate ─────────────────────────────────────────────────

test('attestation gate: unattested deploy is refused', () => {
  const deployment = makeDeployment(); // no attestation
  assert.throws(
    () => requireAttestation(deployment),
    (err: unknown) => {
      assert.ok(err instanceof AttestationRequiredError, 'Should be AttestationRequiredError');
      assert.ok(
        (err as Error).message.includes('Acceptable Use Policy'),
        'Error message should mention the AUP',
      );
      assert.strictEqual((err as AttestationRequiredError).kind, 'attestation_required');
      return true;
    },
  );
});

test('attestation gate: deploy with only acceptedAt (no version) is refused', () => {
  const deployment = makeDeployment({
    attestationAcceptedAt: new Date(),
    attestedTermsVersion: null,
  });
  assert.throws(() => requireAttestation(deployment), AttestationRequiredError);
});

test('attestation gate: deploy attested to a stale version is refused', () => {
  const deployment = makeDeployment({
    attestationAcceptedAt: new Date(),
    attestedTermsVersion: '0.9.0', // old version
  });
  assert.throws(
    () => requireAttestation(deployment),
    (err: unknown) => {
      assert.ok(err instanceof AttestationRequiredError);
      assert.ok((err as Error).message.includes(CURRENT_AUP_VERSION));
      return true;
    },
  );
});

test('attestation gate: deploy attested to current version passes', () => {
  const deployment = makeDeployment({
    attestationAcceptedAt: new Date(),
    attestedTermsVersion: CURRENT_AUP_VERSION,
  });
  // Should not throw
  assert.doesNotThrow(() => requireAttestation(deployment));
});

// ─── validateAttestationPayload ───────────────────────────────────────────────

test('validateAttestationPayload: null payload throws', () => {
  assert.throws(() => validateAttestationPayload(null), /required/i);
});

test('validateAttestationPayload: agreed=false throws plain-language error', () => {
  assert.throws(
    () => validateAttestationPayload({ agreed: false, termsVersion: CURRENT_AUP_VERSION }),
    /must agree/i,
  );
});

test('validateAttestationPayload: missing termsVersion throws', () => {
  assert.throws(
    () => validateAttestationPayload({ agreed: true }),
    /missing.*version/i,
  );
});

test('validateAttestationPayload: wrong version throws with helpful message', () => {
  assert.throws(
    () => validateAttestationPayload({ agreed: true, termsVersion: '0.0.1' }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok((err as Error).message.includes(CURRENT_AUP_VERSION));
      return true;
    },
  );
});

test('validateAttestationPayload: valid payload returns typed object', () => {
  const result = validateAttestationPayload({ agreed: true, termsVersion: CURRENT_AUP_VERSION });
  assert.strictEqual(result.agreed, true);
  assert.strictEqual(result.termsVersion, CURRENT_AUP_VERSION);
});

// ─── buildAttestationData ─────────────────────────────────────────────────────

test('buildAttestationData: stamps current version and a Date', () => {
  const before = new Date();
  const data = buildAttestationData();
  const after = new Date();
  assert.strictEqual(data.attestedTermsVersion, CURRENT_AUP_VERSION);
  assert.ok(data.attestationAcceptedAt instanceof Date);
  assert.ok(data.attestationAcceptedAt >= before);
  assert.ok(data.attestationAcceptedAt <= after);
});

// ─── isAttestationCurrent ────────────────────────────────────────────────────

test('isAttestationCurrent: false for null attestation', () => {
  assert.strictEqual(isAttestationCurrent(makeDeployment()), false);
});

test('isAttestationCurrent: false for stale version', () => {
  assert.strictEqual(
    isAttestationCurrent(makeDeployment({ attestationAcceptedAt: new Date(), attestedTermsVersion: '0.0.1' })),
    false,
  );
});

test('isAttestationCurrent: true for current version with acceptedAt', () => {
  assert.strictEqual(
    isAttestationCurrent(makeDeployment({ attestationAcceptedAt: new Date(), attestedTermsVersion: CURRENT_AUP_VERSION })),
    true,
  );
});

// ─── Mock pin integration test (attestation gate in deploy path) ───────────────

test('unattested deploy is refused before pin (mock)', () => {
  // Simulate what executePin does: call requireAttestation before pinDirectory.
  const deployment = makeDeployment(); // no attestation
  let pinCalled = false;
  const mockPin = () => { pinCalled = true; };

  let caught: unknown;
  try {
    requireAttestation(deployment); // gate
    mockPin();                      // would only reach here if gate passes
  } catch (err) {
    caught = err;
  }

  assert.ok(caught instanceof AttestationRequiredError, 'Gate should throw AttestationRequiredError');
  assert.strictEqual(pinCalled, false, 'Pin must never be called for unattested deploy');
});

test('attested deploy proceeds to pin (mock)', () => {
  const deployment = makeDeployment({
    attestationAcceptedAt: new Date(),
    attestedTermsVersion: CURRENT_AUP_VERSION,
  });
  let pinCalled = false;
  const mockPin = () => { pinCalled = true; };

  requireAttestation(deployment); // should not throw
  mockPin();

  assert.strictEqual(pinCalled, true, 'Pin should be called when attestation is current');
});
