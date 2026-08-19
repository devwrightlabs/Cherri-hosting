-- T2.1: AUP attestation fields on Deployment
-- Adds two nullable fields to record per-deploy attestation:
--   attestationAcceptedAt: when the user clicked "I agree"
--   attestedTermsVersion:  which AUP version they agreed to
--
-- Both are nullable so existing rows are unaffected (no data loss).
-- The pre-pin gate (see services/attestation.ts) enforces that NEW
-- deployments always have these set before the Pinata pin is attempted.

ALTER TABLE "Deployment" ADD COLUMN "attestationAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Deployment" ADD COLUMN "attestedTermsVersion" TEXT;
