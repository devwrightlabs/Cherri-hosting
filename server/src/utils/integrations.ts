/**
 * Centralized external-integration availability checks.
 *
 * The application is designed to keep running even when optional external
 * services (Pi Network, Pinata/IPFS) are not configured. Routes and services
 * use these helpers to fail fast with a clear, structured error instead of
 * throwing opaque runtime errors or crashing the process.
 */
import { isS3Provider, s3ConfigMissing } from '../services/snapshotStoreS3';
import { isDedicatedGatewayConfigured } from './gateway';

/** True when a Pi Network server API key is configured (required for payments). */
export function isPiConfigured(): boolean {
  return Boolean(process.env.PI_API_KEY);
}

/**
 * True when Pinata/IPFS credentials are configured (required for deploys).
 * PINATA_JWT is the primary credential; the api-key/secret pair is a fallback.
 * Values are trimmed so a whitespace-only secret doesn't falsely report as
 * configured (which must stay in lockstep with buildAuthHeaders in ipfs.ts).
 */
export function isPinataConfigured(): boolean {
  const jwt = process.env.PINATA_JWT?.trim();
  const apiKey = process.env.PINATA_API_KEY?.trim();
  const apiSecret = process.env.PINATA_API_SECRET?.trim();
  return Boolean(jwt || (apiKey && apiSecret));
}

/** True when a database connection string is configured. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * True when the Railway provisioning API token is configured. Railway is the
 * "landlord" that runs per-app backend services + Postgres databases on the
 * operator's account. This check is intentionally NOT included in the public
 * `integrationStatus()` snapshot below — end users must never see that Cherri
 * uses Railway. It is used server-side only (startup warning + provisioning).
 */
export function isRailwayConfigured(): boolean {
  return Boolean(process.env.RAILWAY_API_TOKEN?.trim());
}

/**
 * True when the PiRC2 on-chain subscription standard is configured (required to
 * verify allowance approvals and draw recurring charges). PiRC2 is a Soroban
 * smart-contract standard; it needs the subscription contract id, a Soroban RPC
 * endpoint, and the network passphrase.
 */
export function isPirc2Configured(): boolean {
  return Boolean(
    process.env.PIRC2_CONTRACT_ID &&
      process.env.SOROBAN_RPC_URL &&
      process.env.PIRC2_NETWORK_PASSPHRASE,
  );
}

/**
 * True when a backend "template" source for provisioned app backends is
 * configured — either a git repo (RAILWAY_BACKEND_TEMPLATE_REPO) or a container
 * image (RAILWAY_BACKEND_IMAGE). Provisioning needs something concrete to
 * actually deploy as each app's backend service; without it provisioning stays
 * honestly blocked. Operator-only, like the Railway token itself.
 */
export function isBackendTemplateConfigured(): boolean {
  return Boolean(
    process.env.RAILWAY_BACKEND_TEMPLATE_REPO?.trim() ||
      process.env.RAILWAY_BACKEND_IMAGE?.trim(),
  );
}

/**
 * True when a PRIVATE snapshot store is configured AND usable for Phase 7 DB
 * dumps. Raw DB dumps must NEVER be placed on public IPFS, so this gates the
 * destructive snapshot -> delete path. We require not just SNAPSHOT_STORE_PROVIDER
 * but a fully-credentialed, implemented adapter — a provider named without its
 * credentials (or with no adapter) reports NOT configured, so GO-LIVE readiness
 * stays honestly blocked instead of claiming a store that would fail at use time.
 */
export function isSnapshotStoreConfigured(): boolean {
  const provider = process.env.SNAPSHOT_STORE_PROVIDER?.trim();
  if (!provider) return false;
  if (isS3Provider(provider)) return s3ConfigMissing(provider).length === 0;
  return false;
}

/** True when an at-rest encryption key for DB snapshots is configured. */
export function isSnapshotEncryptionConfigured(): boolean {
  return Boolean(process.env.SNAPSHOT_ENCRYPTION_KEY?.trim());
}

/**
 * Error thrown when a feature is invoked but its required external integration
 * is not configured. Routes catch this and return HTTP 503 so the client can
 * surface a friendly "service unavailable" message rather than a 500 crash.
 */
export class IntegrationUnavailableError extends Error {
  readonly integration: string;
  constructor(integration: string, message: string) {
    super(message);
    this.name = 'IntegrationUnavailableError';
    this.integration = integration;
  }
}

/** Snapshot of which integrations are currently available. */
export function integrationStatus() {
  return {
    pi: isPiConfigured(),
    pinata: isPinataConfigured(),
    // Dedicated IPFS gateway (serves HTML; the public gateway blocks it).
    // When false, live links fall back to the public gateway and the client
    // must warn that sites won't render there.
    dedicatedGateway: isDedicatedGatewayConfigured(),
    database: isDatabaseConfigured(),
    pirc2: isPirc2Configured(),
  };
}
