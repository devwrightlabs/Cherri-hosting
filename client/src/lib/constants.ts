/** Premium plan price in Pi — must stay in sync with PREMIUM_PRICE_PI on the server. */
export const PREMIUM_PRICE_PI = 10;

/**
 * Official Pi Network domain auction / billing destination.
 *
 * Sherry Hosting is an infrastructure utility — it does NOT sell domains or
 * process domain bids. All domain acquisition and billing happens on Pi
 * Network's official systems, and this URL is the redirection target the app
 * sends users to. Override it with VITE_PI_DOMAIN_PORTAL_URL when the exact
 * auction endpoint is known for your environment.
 */
const DEFAULT_PI_DOMAIN_PORTAL_URL = 'https://minepi.com';

/** Hosts we trust to be official Pi Network destinations. */
const ALLOWED_PI_DOMAIN_HOSTS = ['minepi.com', 'pinet.com'];

function resolvePiDomainPortalUrl(): string {
  const configured = import.meta.env.VITE_PI_DOMAIN_PORTAL_URL as
    | string
    | undefined;
  if (!configured) return DEFAULT_PI_DOMAIN_PORTAL_URL;
  try {
    const { hostname } = new URL(configured);
    const isAllowed = ALLOWED_PI_DOMAIN_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (isAllowed) return configured;
    console.warn(
      `[constants] VITE_PI_DOMAIN_PORTAL_URL host "${hostname}" is not an official Pi Network domain; falling back to default.`,
    );
  } catch {
    console.warn(
      '[constants] VITE_PI_DOMAIN_PORTAL_URL is not a valid URL; falling back to default.',
    );
  }
  return DEFAULT_PI_DOMAIN_PORTAL_URL;
}

export const PI_DOMAIN_PORTAL_URL = resolvePiDomainPortalUrl();
