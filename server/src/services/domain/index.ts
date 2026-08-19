/**
 * Domain provider selector — T3.1
 *
 * Chooses the right DomainProvider implementation based on the domain type:
 *   - .pi domains        → PiDomainProvider
 *   - everything else    → HostingerDomainProvider (web2 bridge)
 *
 * Add new providers here as Cherri expands beyond Pi + Hostinger.
 */

export * from './DomainProvider';
export { PiDomainProvider } from './PiDomainProvider';
export { HostingerDomainProvider, mapHostingerRecord } from './HostingerDomainProvider';

import type { DomainProvider } from './DomainProvider';
import { PiDomainProvider } from './PiDomainProvider';
import { HostingerDomainProvider } from './HostingerDomainProvider';

// Shared singleton instances (stateless except for Pi inventory, which is in-process).
const piProvider = new PiDomainProvider();
const hostingerProvider = new HostingerDomainProvider();

/**
 * Returns the appropriate DomainProvider for a given domain name.
 *
 * Selection rules:
 *   - Ends with ".pi" → Pi domain provider
 *   - Everything else → Hostinger web2 domain provider
 *
 * Both providers are honest about their gating: Hostinger throws
 * DomainProviderNotConfiguredError when HOSTINGER_API_TOKEN is absent; Pi
 * throws when PI_DOMAIN_INVENTORY is absent.
 */
export function domainProviderFor(domain: string): DomainProvider {
  const normalized = domain.trim().toLowerCase();
  if (normalized.endsWith('.pi')) {
    return piProvider;
  }
  return hostingerProvider;
}

/** Exposed for tests that need a fresh Pi provider instance. */
export { piProvider, hostingerProvider };
