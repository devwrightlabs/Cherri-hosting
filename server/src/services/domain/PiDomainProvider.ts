/**
 * PiDomainProvider — T3.1
 *
 * Implements DomainProvider for Pi Network domains (.pi TLD assigned from an
 * operator-managed auction inventory). No external API is called: Pi domain
 * resolution lives inside the Pi Browser and does not expose a public DNS API.
 * This provider:
 *   - assigns a Pi domain from the in-memory inventory
 *   - stores the domain→CID mapping so the Cherri gateway can route traffic
 *   - returns honest DNS guidance (users must set DNSLink in Pi Network settings)
 *
 * When the inventory is empty, assignment throws honestly instead of faking
 * a domain.
 *
 * Pi domain "DNS": Pi domains do not use standard DNS. Resolution is handled
 * by the Pi Browser via Pi Network's own registry. The standard interface
 * methods (listRecords, upsertRecord, deleteRecord) are implemented but
 * operate on Cherri's internal routing table, not a real DNS zone.
 */

import { liveUrlForCid } from '../../utils/gateway';
import {
  DomainProvider,
  DnsRecord,
  SslStatus,
  DomainMapping,
  ConnectResult,
  DomainProviderNotConfiguredError,
} from './DomainProvider';

// ─── Pi domain inventory ──────────────────────────────────────────────────────

/**
 * In-memory Pi domain inventory.  In production this would be loaded from a DB
 * table or an env-provided list. For pre-stage purposes it is seeded from the
 * PI_DOMAIN_INVENTORY env var (comma-separated) or left empty (no assignment
 * possible until Brenden provides the list — see T3.3).
 *
 * Shape: `domain.pi` strings, no leading dot.
 */
function loadInventory(): string[] {
  const raw = process.env.PI_DOMAIN_INVENTORY?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class PiDomainProvider implements DomainProvider {
  /** Internal mapping table: domain → CID (instance-level so tests can reset) */
  private cidMappings = new Map<string, string>();

  /** Assigned domains: pi-domain → 'assigned' marker */
  private assignments = new Map<string, string>();
  /**
   * Assign an available Pi domain from the inventory to this connection.
   * userId is used to track assignment ownership (passed in the context object
   * as the `domain` param is the *requested* pi domain or empty to auto-assign).
   *
   * For pre-stage: if `domain` is a specific .pi domain from the inventory we
   * try to claim it; otherwise we auto-assign the first available one.
   */
  async connectDomain(domain: string): Promise<ConnectResult> {
    const inventory = loadInventory();

    if (inventory.length === 0) {
      throw new DomainProviderNotConfiguredError(
        'pi',
        'No Pi domain inventory is configured. Set PI_DOMAIN_INVENTORY (comma-separated list of .pi domains) to enable Pi domain assignment. This will be populated from the auction list — see T3.3.',
      );
    }

    const normalized = domain.trim().toLowerCase();
    const available = inventory.filter((d) => !this.assignments.has(d));

    if (available.length === 0) {
      throw new Error('All Pi domains in the inventory are already assigned. Contact the operator to expand the inventory.');
    }

    // If a specific domain was requested and it's available, use it.
    // Otherwise auto-assign the first available one.
    const target = (normalized && available.includes(normalized))
      ? normalized
      : available[0];

    this.assignments.set(target, 'assigned');

    return {
      domain: target,
      pendingSteps: [
        `Go to Pi Network developer settings and point "${target}" at Cherri's gateway.`,
        `Set the DNSLink value to: dnslink=/ipfs/<your-deployment-cid>`,
        'Pi Browser users will be able to reach your site once propagation completes (may take up to 10 minutes).',
      ],
    };
  }

  async listRecords(domain: string): Promise<DnsRecord[]> {
    // Pi domains don't have standard DNS records. We return the DNSLink record
    // if a CID mapping exists, so callers get a consistent shape.
    const cid = this.cidMappings.get(domain.toLowerCase());
    if (!cid) return [];
    return [
      {
        type: 'TXT',
        name: '_dnslink',
        content: `dnslink=/ipfs/${cid}`,
        ttl: 300,
      },
    ];
  }

  async upsertRecord(domain: string, record: DnsRecord): Promise<DnsRecord> {
    // Pi domains do not support arbitrary DNS edits via an API. For TXT records
    // (specifically DNSLink) we persist internally; everything else is no-op but
    // documented honestly.
    if (record.type === 'TXT' && record.name.startsWith('_dnslink')) {
      // Extract the CID from the DNSLink value if present.
      const match = record.content.match(/dnslink=\/ipfs\/([A-Za-z0-9]+)/);
      if (match) this.cidMappings.set(domain.toLowerCase(), match[1]);
    }
    return record;
  }

  async deleteRecord(
    domain: string,
    record: Pick<DnsRecord, 'type' | 'name' | 'content'>,
  ): Promise<void> {
    if (record.type === 'TXT' && record.name.startsWith('_dnslink')) {
      this.cidMappings.delete(domain.toLowerCase());
    }
    // Other record types are no-ops for Pi domains.
  }

  async provisionSsl(_domain: string): Promise<void> {
    // Pi Browser connections are handled inside the Pi Network sandbox (HTTPS
    // by default). There is no external Let's Encrypt SSL to provision.
    // This is a no-op because SSL is managed by Pi Network, not by Cherri.
  }

  async sslStatus(_domain: string): Promise<SslStatus> {
    return {
      state: 'ACTIVE',
      detail: 'Pi Browser enforces HTTPS natively. No separate SSL certificate is required for .pi domains.',
    };
  }

  async mapToCid(domain: string, cid: string): Promise<DomainMapping> {
    const normalized = domain.trim().toLowerCase();
    this.cidMappings.set(normalized, cid);

    const gatewayUrl = liveUrlForCid(cid, 'index.html');
    const dnslink = `dnslink=/ipfs/${cid}`;

    return {
      domain: normalized,
      cid,
      gatewayUrl,
      dnslink,
    };
  }

  async removeMapping(domain: string): Promise<void> {
    this.cidMappings.delete(domain.trim().toLowerCase());
  }

  // ─── Testing helpers (exported for unit tests only) ─────────────────────────

  /** Returns the current CID for a domain, or undefined if not mapped. */
  getCidForDomain(domain: string): string | undefined {
    return this.cidMappings.get(domain.toLowerCase());
  }

  /** Clears all in-memory state (use in tests only). */
  reset(): void {
    this.cidMappings.clear();
    this.assignments.clear();
  }
}
