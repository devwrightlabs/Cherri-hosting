/**
 * T2.1 — AUP Attestation gate (pre-pin choke point)
 *
 * Enforces that a Deployment has a valid AUP attestation BEFORE the Pinata
 * pin is attempted.  This is the single pre-pin gate for per-deploy attestation.
 *
 * Called from the pin pipeline in routes/deployments.ts (executePin) right
 * before pinDirectory / pinFile.  Any deployment missing attestation is refused
 * with a clear, honest plain-language error — never faked past.
 *
 * Also provides helpers to:
 *   - record attestation on a Deployment row
 *   - check whether a deployment has a current-version attestation
 */

import { CURRENT_AUP_VERSION } from '../utils/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of the attestation payload a client must send before publishing. */
export interface AttestationPayload {
  /** Must be true — user actively checked "I agree", never a hidden field. */
  agreed: boolean;
  /** The AUP version the UI presented to the user. */
  termsVersion: string;
}

/**
 * The minimal Deployment shape the gate needs to check — matches the Prisma
 * Deployment model fields added in T2.1. Using a structural type so tests can
 * pass plain objects without needing a real Prisma instance.
 */
export interface DeploymentAttestation {
  id: string;
  attestationAcceptedAt: Date | null;
  attestedTermsVersion: string | null;
}

// ─── Error type ───────────────────────────────────────────────────────────────

/**
 * Thrown when a deploy is refused due to missing or stale attestation.
 * Routes should surface the `message` directly to the user — it is already
 * plain language, no stack traces.
 */
export class AttestationRequiredError extends Error {
  readonly kind = 'attestation_required' as const;
  readonly currentVersion: string;
  constructor(message: string) {
    super(message);
    this.name = 'AttestationRequiredError';
    this.currentVersion = CURRENT_AUP_VERSION;
  }
}

// ─── Gate ────────────────────────────────────────────────────────────────────

/**
 * Verify that a Deployment has a valid, current-version AUP attestation.
 * Throws AttestationRequiredError if the attestation is absent or for an
 * outdated policy version.
 *
 * This is the SINGLE place in the deploy path where attestation is enforced —
 * insert it immediately before every Pinata pin call (pinDirectory / pinFile).
 */
export function requireAttestation(deployment: DeploymentAttestation): void {
  if (!deployment.attestationAcceptedAt || !deployment.attestedTermsVersion) {
    throw new AttestationRequiredError(
      'You must agree to the Cherri Acceptable Use Policy before publishing. ' +
        'Tick the "I agree" checkbox and try again.',
    );
  }

  if (deployment.attestedTermsVersion !== CURRENT_AUP_VERSION) {
    throw new AttestationRequiredError(
      `The Acceptable Use Policy has been updated (now version ${CURRENT_AUP_VERSION}). ` +
        'Please review the updated policy and agree to the new terms before publishing.',
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validate that a client-supplied attestation payload is well-formed before
 * persisting it. Returns the payload if valid; throws a plain-language Error
 * if the user did not actually agree or supplied an unrecognized version.
 */
export function validateAttestationPayload(payload: unknown): AttestationPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Attestation payload is required.');
  }
  const p = payload as Record<string, unknown>;

  if (p.agreed !== true) {
    throw new Error(
      'You must agree to the Acceptable Use Policy to publish on Cherri Hosting.',
    );
  }

  const version = typeof p.termsVersion === 'string' ? p.termsVersion.trim() : '';
  if (!version) {
    throw new Error('Attestation payload is missing the policy version.');
  }

  if (version !== CURRENT_AUP_VERSION) {
    throw new Error(
      `The policy version you agreed to (${version}) doesn't match the current version (${CURRENT_AUP_VERSION}). ` +
        'Please refresh the page and agree to the current policy.',
    );
  }

  return { agreed: true, termsVersion: version };
}

/**
 * Build the Prisma data object for recording attestation on a Deployment row.
 * Always stamps the current time and the CURRENT_AUP_VERSION.
 */
export function buildAttestationData(): {
  attestationAcceptedAt: Date;
  attestedTermsVersion: string;
} {
  return {
    attestationAcceptedAt: new Date(),
    attestedTermsVersion: CURRENT_AUP_VERSION,
  };
}

/**
 * True when the deployment has a valid, current-version attestation.
 * Convenience predicate for UI checks (does not throw).
 */
export function isAttestationCurrent(deployment: DeploymentAttestation): boolean {
  return (
    deployment.attestationAcceptedAt !== null &&
    deployment.attestedTermsVersion === CURRENT_AUP_VERSION
  );
}
