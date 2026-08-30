/**
 * Custom DNS Provider Module for Cherri Hosting
 * 
 * Modular interface for DNS operations, built to easily integrate future Pi Network API.
 * Currently implements memory-based DNS state with Pi domain auction support.
 * Future: Swap implementation to call Pi Network API without changing this interface.
 */

export interface DNSRecord {
  name: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX';
  value: string;
  ttl: number;
}

export interface DomainInfo {
  name: string;
  tld: '.pie' | '.pi';
  owner: string;
  isAvailable: boolean;
  suggestedAlternatives: string[];
  verificationToken?: string;
  dnsRecords: DNSRecord[];
}

export interface DNSProvider {
  /**
   * Check domain availability on Pi Network.
   * Returns availability status and suggested alternatives.
   */
  checkAvailability(domain: string): Promise<{
    available: boolean;
    domain: string;
    alternatives: string[];
  }>;

  /**
   * Register or claim a domain for a user.
   * Returns domain info with verification token.
   */
  registerDomain(
    domain: string,
    userId: string,
    tld?: '.pie' | '.pi'
  ): Promise<DomainInfo>;

  /**
   * Assign a .pie subdomain automatically for free tier.
   * Pattern: {projectName}.{userId}.pie
   */
  assignSubdomain(projectName: string, userId: string): Promise<string>;

  /**
   * Update DNS records for a domain.
   */
  updateDNSRecords(domain: string, records: DNSRecord[]): Promise<DomainInfo>;

  /**
   * Get verification token for Pi Developer Portal integration.
   */
  getVerificationToken(domain: string): Promise<string>;

  /**
   * Set up CNAME/A record pointing to deployment.
   */
  pointToDeployment(
    domain: string,
    deploymentCID: string
  ): Promise<DomainInfo>;
}

/**
 * In-memory DNS provider implementation.
 * Future: Replace with Pi Network API calls.
 */
export class InMemoryDNSProvider implements DNSProvider {
  private domains = new Map<string, DomainInfo>();
  private subdomainIndex = new Map<string, string>(); // userId/projectName -> domain

  async checkAvailability(domain: string): Promise<{
    available: boolean;
    domain: string;
    alternatives: string[];
  }> {
    const isAvailable = !this.domains.has(domain);
    
    // Generate alternatives if taken
    const alternatives = isAvailable ? [] : [
      `${domain}-hub`,
      `${domain}-pro`,
      `${domain}-labs`,
      `${domain}-io`,
    ];

    return {
      available: isAvailable,
      domain,
      alternatives,
    };
  }

  async registerDomain(
    domain: string,
    userId: string,
    tld: '.pie' | '.pi' = '.pie'
  ): Promise<DomainInfo> {
    const fullDomain = domain.endsWith(tld) ? domain : `${domain}${tld}`;
    
    if (this.domains.has(fullDomain)) {
      throw new Error(`Domain ${fullDomain} is already registered`);
    }

    const verificationToken = this.generateVerificationToken();
    const domainInfo: DomainInfo = {
      name: fullDomain,
      tld,
      owner: userId,
      isAvailable: false,
      suggestedAlternatives: [],
      verificationToken,
      dnsRecords: [],
    };

    this.domains.set(fullDomain, domainInfo);
    return domainInfo;
  }

  async assignSubdomain(
    projectName: string,
    userId: string
  ): Promise<string> {
    const key = `${userId}/${projectName}`;
    
    if (this.subdomainIndex.has(key)) {
      return this.subdomainIndex.get(key)!;
    }

    // Generate free tier subdomain: {projectName}.{userId}.pie
    const subdomain = `${projectName}.${userId}.pie`;
    this.subdomainIndex.set(key, subdomain);

    // Auto-register the subdomain
    if (!this.domains.has(subdomain)) {
      await this.registerDomain(subdomain, userId, '.pie');
    }

    return subdomain;
  }

  async updateDNSRecords(
    domain: string,
    records: DNSRecord[]
  ): Promise<DomainInfo> {
    const domainInfo = this.domains.get(domain);
    
    if (!domainInfo) {
      throw new Error(`Domain ${domain} not found`);
    }

    domainInfo.dnsRecords = records;
    return domainInfo;
  }

  async getVerificationToken(domain: string): Promise<string> {
    const domainInfo = this.domains.get(domain);
    
    if (!domainInfo) {
      throw new Error(`Domain ${domain} not found`);
    }

    if (!domainInfo.verificationToken) {
      domainInfo.verificationToken = this.generateVerificationToken();
    }

    return domainInfo.verificationToken;
  }

  async pointToDeployment(
    domain: string,
    deploymentCID: string
  ): Promise<DomainInfo> {
    const domainInfo = this.domains.get(domain);
    
    if (!domainInfo) {
      throw new Error(`Domain ${domain} not found`);
    }

    // Add CNAME record pointing to IPFS gateway
    const cnamRecord: DNSRecord = {
      name: domain,
      type: 'CNAME',
      value: `${deploymentCID}.ipfs.nativeplanet.io`,
      ttl: 3600,
    };

    domainInfo.dnsRecords = [cnamRecord];
    return domainInfo;
  }

  private generateVerificationToken(): string {
    // Generate a unique token for Pi Developer Portal verification
    // Format: cherri_{timestamp}_{randomString}
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `cherri_${timestamp}_${random}`;
  }
}

// Export singleton instance
export const dnsProvider = new InMemoryDNSProvider();
