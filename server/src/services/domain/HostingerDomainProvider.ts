/**
 * HostingerDomainProvider — T3.1 / T3.2 web2 bridge seam
 *
 * Implements DomainProvider by wrapping the Hostinger domains/DNS/SSL API.
 * This is the "web2 bridge" described in VISION-STAGES.md §4 — Cherri routes
 * real domain management through the Hostinger API rather than rebuilding a
 * full registrar/DNS stack.
 *
 * GATED SEAM: every method requires HOSTINGER_API_TOKEN.  When the token is
 * absent, each method throws DomainProviderNotConfiguredError with a clear
 * explanation — exactly the same pattern as describeRemoteBuilder() in
 * buildSecurity.ts.  The real call shape is stubbed + commented so wiring is
 * a matter of filling in the Axios calls, not redesigning the interface.
 *
 * Brenden: to activate, set HOSTINGER_API_TOKEN in hPanel → OpenClaw →
 * Environment.  The Hostinger MCP already has this key; this provider just
 * needs it exposed server-side.
 */

import { liveUrlForCid } from '../../utils/gateway';
import {
  DomainProvider,
  DnsRecord,
  DnsRecordType,
  SslStatus,
  DomainMapping,
  ConnectResult,
  DomainProviderNotConfiguredError,
} from './DomainProvider';

// ─── Auth check ───────────────────────────────────────────────────────────────

const PROVIDER = 'hostinger';

function requireToken(): string {
  const token = process.env.HOSTINGER_API_TOKEN?.trim();
  if (!token) {
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'Hostinger domain management requires HOSTINGER_API_TOKEN. ' +
        'Set it in hPanel → OpenClaw → Environment to activate the web2 domain bridge. ' +
        'The Hostinger MCP agent already has access — this is just the server-side credential.',
    );
  }
  return token;
}

// ─── Hostinger API base URL ───────────────────────────────────────────────────

// Production: https://api.hostinger.com
// The Hostinger API MCP uses the same base; keep in sync with that integration.
const HOSTINGER_API_BASE = 'https://api.hostinger.com';

// ─── Type helpers (Hostinger API shapes) ─────────────────────────────────────
// These mirror the real Hostinger API response shapes documented at
// https://api.hostinger.com/openapi.  Filled in from the Hostinger MCP spec.
// Uncomment + fill in real Axios calls to activate each method.

/* eslint-disable @typescript-eslint/no-unused-vars */

interface HostingerDnsRecord {
  id?: number;
  type: string;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
}

/* eslint-enable @typescript-eslint/no-unused-vars */

// ─── Shared fetch helper (stubbed — activate by importing axios or node-fetch) ─

/**
 * Placeholder for the real Hostinger API client.
 * Wire this to an Axios instance (already in server deps) once the token is
 * confirmed available:
 *
 * ```ts
 * import axios from 'axios';
 * const api = axios.create({
 *   baseURL: HOSTINGER_API_BASE,
 *   headers: { Authorization: `Bearer ${token}` },
 *   timeout: 15_000,
 * });
 * ```
 */
function makeClient(_token: string) {
  // TODO (T3.2): return an axios instance with the Hostinger API base URL and
  // Bearer auth header.  The stub below is intentionally not-callable so
  // TypeScript proves the gate is closed until the real call is wired in.
  return {
    get: (_path: string): never => {
      throw new DomainProviderNotConfiguredError(
        PROVIDER,
        'HostingerDomainProvider real API calls are not yet wired (T3.2 is pending Brenden\'s confirmation to wrap Hostinger for web2 domains). The interface and auth-check are ready — wire the Axios calls to activate.',
      );
    },
    post: (_path: string, _data?: unknown): never => {
      throw new DomainProviderNotConfiguredError(
        PROVIDER,
        'HostingerDomainProvider real API calls are not yet wired (T3.2 pending). See above.',
      );
    },
    put: (_path: string, _data?: unknown): never => {
      throw new DomainProviderNotConfiguredError(
        PROVIDER,
        'HostingerDomainProvider real API calls are not yet wired (T3.2 pending). See above.',
      );
    },
    delete: (_path: string): never => {
      throw new DomainProviderNotConfiguredError(
        PROVIDER,
        'HostingerDomainProvider real API calls are not yet wired (T3.2 pending). See above.',
      );
    },
  };
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class HostingerDomainProvider implements DomainProvider {
  /**
   * Connect a real domain to Hostinger management.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // POST /api/hosting/v1/websites/<username>/<domain>/parked-domains
   * // or use the Hostinger domain-verification flow
   * await api.post(`/api/hosting/v1/dns/verify/${domain}`);
   * ```
   */
  async connectDomain(domain: string): Promise<ConnectResult> {
    const token = requireToken();
    const _client = makeClient(token);

    // TODO (T3.2): Real implementation —
    // 1. POST to Hostinger to link/verify the domain
    // 2. Return required nameserver / TXT verification steps
    //
    // Stub: token gate is exercised (throws if absent); client call not yet wired.
    void _client; // suppress unused-var lint while stub is in place
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'HostingerDomainProvider.connectDomain: real API call is not yet wired (T3.2). ' +
        'Auth gate is active — set HOSTINGER_API_TOKEN and wire the Axios call to activate.',
    );
  }

  /**
   * List DNS records via Hostinger DNS API.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // GET /api/dns/v1/domains/<domain>/records
   * const resp = await api.get(`/api/dns/v1/domains/${domain}/records`);
   * return (resp.data.zone as HostingerDnsRecord[]).map(mapRecord);
   * ```
   */
  async listRecords(domain: string): Promise<DnsRecord[]> {
    const token = requireToken();
    const _client = makeClient(token);
    void domain;
    void _client;
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'HostingerDomainProvider.listRecords: real API call not yet wired (T3.2).',
    );
  }

  /**
   * Create or update a DNS record via Hostinger.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // POST /api/dns/v1/domains/<domain>/records (with overwrite:true)
   * // See: hostinger-api__DNS_updateDNSRecordsV1 in MCP tools
   * await api.post(`/api/dns/v1/domains/${domain}/records`, {
   *   overwrite: true,
   *   zone: [{ name: record.name, type: record.type, ttl: record.ttl ?? 3600,
   *             records: [{ content: record.content }] }],
   * });
   * ```
   */
  async upsertRecord(domain: string, record: DnsRecord): Promise<DnsRecord> {
    const token = requireToken();
    const _client = makeClient(token);
    void domain;
    void _client;
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'HostingerDomainProvider.upsertRecord: real API call not yet wired (T3.2).',
    );
  }

  /**
   * Delete a DNS record via Hostinger.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // DELETE /api/dns/v1/domains/<domain>/records
   * // See: hostinger-api__DNS_deleteDNSRecordsV1 in MCP tools
   * ```
   */
  async deleteRecord(
    domain: string,
    record: Pick<DnsRecord, 'type' | 'name' | 'content'>,
  ): Promise<void> {
    const token = requireToken();
    const _client = makeClient(token);
    void domain;
    void record;
    void _client;
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'HostingerDomainProvider.deleteRecord: real API call not yet wired (T3.2).',
    );
  }

  /**
   * Trigger Let's Encrypt SSL provisioning via Hostinger.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // Hostinger auto-provisions SSL when a domain is connected; or use the
   * // domain details endpoint to trigger a re-issue:
   * // GET /api/domains/v1/domains/<domain> + check sslStatus
   * ```
   */
  async provisionSsl(domain: string): Promise<void> {
    const token = requireToken();
    const _client = makeClient(token);
    void domain;
    void _client;
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'HostingerDomainProvider.provisionSsl: real API call not yet wired (T3.2).',
    );
  }

  /**
   * Check SSL certificate status via Hostinger.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // GET /api/domains/v1/domains/<domain>
   * // Map the `ssl_status` field to our SslState enum.
   * ```
   */
  async sslStatus(domain: string): Promise<SslStatus> {
    const token = requireToken();
    const _client = makeClient(token);
    void domain;
    void _client;
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'HostingerDomainProvider.sslStatus: real API call not yet wired (T3.2).',
    );
  }

  /**
   * Map a domain to a CID by writing a DNSLink TXT record via Hostinger DNS API.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // 1. POST to Hostinger DNS API to upsert the DNSLink TXT record:
   * //    name: "_dnslink"
   * //    type: "TXT"
   * //    content: `dnslink=/ipfs/${cid}`
   * // 2. Also upsert an A record or CNAME pointing at the Cherri gateway IP.
   * ```
   */
  async mapToCid(domain: string, cid: string): Promise<DomainMapping> {
    const token = requireToken();
    const _client = makeClient(token);
    void _client;

    // Even though the real DNS call is not wired, we can compute the derived values.
    // This is the gate: token must be present to proceed.
    const gatewayUrl = liveUrlForCid(cid, 'index.html');
    const dnslink = `dnslink=/ipfs/${cid}`;

    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      `HostingerDomainProvider.mapToCid: real DNS API call not yet wired (T3.2). ` +
        `When wired, this will set _dnslink TXT → "${dnslink}" for ${domain}.`,
    );
  }

  /**
   * Remove the CID→domain mapping by deleting the DNSLink TXT record.
   *
   * Real wire-up (T3.2):
   * ```ts
   * // DELETE /api/dns/v1/domains/<domain>/records
   * // Filter: name="_dnslink", type="TXT"
   * ```
   */
  async removeMapping(domain: string): Promise<void> {
    const token = requireToken();
    const _client = makeClient(token);
    void domain;
    void _client;
    throw new DomainProviderNotConfiguredError(
      PROVIDER,
      'HostingerDomainProvider.removeMapping: real API call not yet wired (T3.2).',
    );
  }
}

/**
 * Maps a Hostinger DNS record shape to our canonical DnsRecord type.
 * Used in the real wire-up (T3.2) — kept here so it's ready to import.
 *
 * @internal
 */
export function mapHostingerRecord(r: HostingerDnsRecord): DnsRecord {
  return {
    type: r.type as DnsRecordType,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    priority: r.priority,
  };
}
