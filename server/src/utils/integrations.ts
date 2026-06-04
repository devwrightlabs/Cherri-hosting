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

/** True when Pinata/IPFS credentials are configured (required for deploys). */
export function isPinataConfigured(): boolean {
  return Boolean(
    process.env.PINATA_JWT ||
      (process.env.PINATA_API_KEY && process.env.PINATA_API_SECRET),
  );
}

/** True when a database connection string is configured. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
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
