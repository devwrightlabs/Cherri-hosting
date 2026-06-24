/**
 * Centralized external-integration availability checks.
 *
 * The application is designed to keep running even when optional external
 * services (Pi Network, Pinata/IPFS) are not configured. Routes and services
 * use these helpers to fail fast with a clear, structured error instead of
 * throwing opaque runtime errors or crashing the process.
 */

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
    database: isDatabaseConfigured(),
    pirc2: isPirc2Configured(),
  };
}
