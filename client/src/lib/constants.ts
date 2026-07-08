/** Legacy / backward-compat Premium plan price in Pi. */
export const PREMIUM_PRICE_PI = 10;

/** Builder (Tier 1) — 26 Pi / month */
export const TIER1_PRICE_PI = 26;
/** Pro (Tier 2) — 44 Pi / month */
export const TIER2_PRICE_PI = 44;
/** Business (Tier 3) — 143 Pi / month */
export const TIER3_PRICE_PI = 143;
/** Legacy Enterprise (Tier 4) — 125 Pi / month (not sold on the pricing page) */
export const TIER4_PRICE_PI = 125;

/** Annual plans bill 10× the monthly price (i.e. two months free). */
export const ANNUAL_MULTIPLIER = 10;

export const TIER_LABELS: Record<string, string> = {
  FREE: 'Starter',
  TIER1: 'Builder',
  TIER2: 'Pro',
  TIER3: 'Business',
  TIER4: 'Enterprise',
  PREMIUM: 'Premium',
};

export const TIER_STORAGE_LABELS: Record<string, string> = {
  FREE: '500 MB',
  TIER1: '2 GB',
  TIER2: '10 GB',
  TIER3: '50 GB',
  TIER4: '100 GB',
  PREMIUM: '10 GB',
};

/**
 * Official Pi Network domain auction / billing destination.
 *
 * Cherri Hosting is an infrastructure utility — it does NOT sell domains or
 * process domain bids. All domain acquisition and billing happens on Pi
 * Network's official systems, and this URL is the redirection target the app
 * sends users to. Override it with VITE_PI_DOMAIN_PORTAL_URL when the exact
 * auction endpoint is known for your environment.
 */
const DEFAULT_PI_DOMAIN_PORTAL_URL = 'https://domains.pinet.com/auctions';

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

/**
 * Pi's Developer Portal — where apps are registered and validation keys are
 * issued. The `.pi` address only resolves inside Pi Browser (Pi Network
 * controls that resolution), which is fine for a Pi-Browser-first product;
 * UI copy that links here should say so.
 */
export const PI_DEVELOPER_PORTAL_URL = 'https://develop.pi';
