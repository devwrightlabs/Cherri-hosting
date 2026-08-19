/**
 * DomainProvider abstraction — T3.1
 *
 * Defines the interface every domain provider must implement. Cherri supports
 * two provider types today:
 *   - "pi"       → Pi-domain (auction inventory, IPFS-native)
 *   - "hostinger" → Real/web2 domain via Hostinger API (web2 bridge)
 *
 * Any implementation that touches a real external API (Hostinger, Pi Registry)
 * throws an honest NOT_CONFIGURED error when the required keys are absent —
 * exactly the same pattern as describeRemoteBuilder() in buildSecurity.ts.
 * Never fake success.
 */

// ─── DNS record types ─────────────────────────────────────────────────────────

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS' | 'CAA' | 'SRV' | 'ALIAS';

export interface DnsRecord {
  /** Record type */
  type: DnsRecordType;
  /** Record name (use '@' for the zone apex) */
  name: string;
  /** Record content (IP, target hostname, TXT value, etc.) */
  content: string;
  /** TTL in seconds; 0 = provider default */
  ttl?: number;
  /** Priority (MX, SRV) */
  priority?: number;
}

// ─── SSL status ───────────────────────────────────────────────────────────────

export type SslState =
  | 'NOT_PROVISIONED'
  | 'PENDING'
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'ERROR';

export interface SslStatus {
  state: SslState;
  /** ISO-8601 expiry date when state is ACTIVE, EXPIRING_SOON, or EXPIRED */
  expiresAt?: string;
  /** Human-readable detail for PENDING / ERROR states */
  detail?: string;
}

// ─── Domain mapping ───────────────────────────────────────────────────────────

export interface DomainMapping {
  /** The domain being mapped */
  domain: string;
  /** IPFS content identifier the domain resolves to */
  cid: string;
  /** Public gateway URL derived from the CID */
  gatewayUrl: string;
  /** DNSLink TXT value (dnslink=/ipfs/<cid>) */
  dnslink: string;
}

// ─── Connection result ────────────────────────────────────────────────────────

export interface ConnectResult {
  /** Operational domain (may differ from input after normalization) */
  domain: string;
  /** Additional steps the user must complete (e.g. point nameservers) */
  pendingSteps?: string[];
}

// ─── The interface ────────────────────────────────────────────────────────────

/**
 * Every domain provider must implement this interface.
 *
 * Implementations are pure service objects — no Express route logic, no direct
 * DB calls. Routes own those concerns.
 */
export interface DomainProvider {
  /**
   * Connect a domain to this provider (claim, verify ownership, delegate
   * nameservers, etc.). Returns the canonical domain name + any pending
   * user-action steps.
   */
  connectDomain(domain: string): Promise<ConnectResult>;

  /**
   * List the current DNS records for a domain.
   */
  listRecords(domain: string): Promise<DnsRecord[]>;

  /**
   * Create or update a DNS record. Upsert semantics: if a record with the
   * same name+type already exists, update its content; otherwise create it.
   * Returns the persisted record.
   */
  upsertRecord(domain: string, record: DnsRecord): Promise<DnsRecord>;

  /**
   * Delete a specific DNS record. Idempotent: deleting a record that does
   * not exist succeeds without error.
   */
  deleteRecord(domain: string, record: Pick<DnsRecord, 'type' | 'name' | 'content'>): Promise<void>;

  /**
   * Request SSL certificate provisioning (Let's Encrypt or provider-managed).
   * Returns immediately; poll sslStatus() to track progress.
   */
  provisionSsl(domain: string): Promise<void>;

  /**
   * Return the current SSL certificate state for a domain.
   */
  sslStatus(domain: string): Promise<SslStatus>;

  /**
   * Map a domain to an IPFS CID so that the Cherri gateway routes traffic for
   * that domain to the content at the given CID.
   * Returns the mapping including the derived gateway URL and DNSLink value.
   */
  mapToCid(domain: string, cid: string): Promise<DomainMapping>;

  /**
   * Remove the CID → domain mapping (e.g. when a deployment is taken down).
   * Idempotent.
   */
  removeMapping(domain: string): Promise<void>;
}

// ─── Shared error type ────────────────────────────────────────────────────────

/**
 * Thrown when a DomainProvider method is called but its required external
 * credentials / config are absent. Mirrors IntegrationUnavailableError in
 * integrations.ts — kept separate so domain-specific context can be attached.
 */
export class DomainProviderNotConfiguredError extends Error {
  readonly provider: string;
  constructor(provider: string, message: string) {
    super(message);
    this.name = 'DomainProviderNotConfiguredError';
    this.provider = provider;
  }
}
