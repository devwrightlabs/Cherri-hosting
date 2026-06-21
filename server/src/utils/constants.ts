/** Free tier storage limit: 500 MB */
export const FREE_STORAGE_LIMIT_BYTES = 524_288_000;

/** Legacy PREMIUM tier storage limit (backward compat = TIER2): 10 GB */
export const PREMIUM_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/** Tier 1: 2 GB storage */
export const TIER1_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

/** Tier 2: 10 GB storage */
export const TIER2_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/** Tier 3: 50 GB storage */
export const TIER3_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024 * 1024;

/** Tier 4: 100 GB storage */
export const TIER4_STORAGE_LIMIT_BYTES = 100 * 1024 * 1024 * 1024;

/** Free tier max upload size: 50 MB */
export const FREE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Legacy PREMIUM tier max upload (backward compat = TIER2): 1 GB */
export const PREMIUM_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Tier 1 max upload: 200 MB */
export const TIER1_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Tier 2 max upload: 1 GB */
export const TIER2_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/**
 * Tier 3 & 4 max upload: 2 GB (practical in-memory ceiling; disk-streaming
 * would be needed to support the full 5/10 GB plan limits).
 */
export const TIER3_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const TIER4_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** Current tier prices in Pi / month (pricing v2, 2026-06). */
export const PREMIUM_PRICE_PI = 10;
export const TIER1_PRICE_PI = 26;
export const TIER2_PRICE_PI = 44;
export const TIER3_PRICE_PI = 143;
/** Legacy Enterprise tier — not sold on the pricing page; recovery/grandfather only. */
export const TIER4_PRICE_PI = 125;

/** Annual plans bill 10× the monthly price (i.e. two months free). */
export const ANNUAL_MULTIPLIER = 10;

/**
 * Pre-v2 monthly prices. Honoured ONLY when recovering a Pi payment that was
 * created before the v2 rollout (see PRICING_V2_CUTOFF) — never for new
 * purchases, so the price increase can't be bypassed by replaying an old amount.
 */
export const LEGACY_TIER1_PRICE_PI = 17;
export const LEGACY_TIER2_PRICE_PI = 35;
export const LEGACY_TIER3_PRICE_PI = 88;

/**
 * Rollout moment of pricing v2. A Pi payment whose created_at predates this is
 * eligible to resolve against legacy prices (grandfathering); anything created
 * at/after this must match a current price.
 */
export const PRICING_V2_CUTOFF = new Date('2026-06-21T00:00:00.000Z');

/**
 * Max number of custom Pi domains that can be mapped per tier.
 * -1 = unlimited.
 */
export const TIER_DOMAIN_LIMITS: Record<string, number> = {
  FREE: 1,
  PREMIUM: 5,  // backward compat → same as TIER2
  TIER1: 1,
  TIER2: 5,
  TIER3: -1,
  TIER4: -1,
};

/** Resolved entitlement for a verified Pi payment amount. */
export interface TierResolution {
  tierName: string;
  storageLimit: number;
  uploadLimit: number;
  /** Paid period length in months — 1 for monthly, 12 for annual plans. */
  months: number;
}

interface PriceEntry {
  amount: number;
  tierName: 'TIER1' | 'TIER2' | 'TIER3' | 'TIER4';
  months: number;
}

/** Pi amounts are whole numbers here; tolerate float noise on equality. */
const AMOUNT_EPSILON = 1e-6;

/**
 * Prices accepted for ALL new purchases — current monthly + annual (×10).
 * Exact-match only: an amount must equal a listed price, so the >= cascade can
 * no longer mis-map an annual amount (e.g. 260π Builder) onto a higher tier.
 */
const CURRENT_PRICE_ENTRIES: PriceEntry[] = [
  { amount: TIER1_PRICE_PI, tierName: 'TIER1', months: 1 },
  { amount: TIER2_PRICE_PI, tierName: 'TIER2', months: 1 },
  { amount: TIER3_PRICE_PI, tierName: 'TIER3', months: 1 },
  { amount: TIER1_PRICE_PI * ANNUAL_MULTIPLIER, tierName: 'TIER1', months: 12 },
  { amount: TIER2_PRICE_PI * ANNUAL_MULTIPLIER, tierName: 'TIER2', months: 12 },
  { amount: TIER3_PRICE_PI * ANNUAL_MULTIPLIER, tierName: 'TIER3', months: 12 },
];

/**
 * Pre-v2 prices, honoured ONLY for grandfathered recovery (allowLegacy) of a
 * payment created before PRICING_V2_CUTOFF. Never accepted for new purchases —
 * otherwise a tampered client could keep buying paid tiers at the old amount.
 */
const LEGACY_PRICE_ENTRIES: PriceEntry[] = [
  { amount: LEGACY_TIER1_PRICE_PI, tierName: 'TIER1', months: 1 },
  { amount: LEGACY_TIER2_PRICE_PI, tierName: 'TIER2', months: 1 },
  { amount: LEGACY_TIER3_PRICE_PI, tierName: 'TIER3', months: 1 },
  { amount: TIER4_PRICE_PI, tierName: 'TIER4', months: 1 },
  { amount: PREMIUM_PRICE_PI, tierName: 'TIER2', months: 1 }, // legacy Premium → TIER2
];

function storageLimitForTier(tierName: string): number {
  switch (tierName) {
    case 'TIER4': return TIER4_STORAGE_LIMIT_BYTES;
    case 'TIER3': return TIER3_STORAGE_LIMIT_BYTES;
    case 'TIER2': return TIER2_STORAGE_LIMIT_BYTES;
    case 'TIER1': return TIER1_STORAGE_LIMIT_BYTES;
    default: return PREMIUM_STORAGE_LIMIT_BYTES;
  }
}

function matchPriceEntry(amount: number, entries: PriceEntry[]): PriceEntry | null {
  return entries.find((e) => Math.abs(amount - e.amount) < AMOUNT_EPSILON) ?? null;
}

/**
 * Resolve a subscription entitlement from a SERVER-verified Pi payment amount.
 *
 * Current prices are always accepted. Legacy prices are accepted only when
 * `allowLegacy` is set (the recovery path passes it for payments created before
 * the v2 cutoff). Returns null when the amount matches no permitted plan.
 */
export function resolveTierFromAmount(
  amount: number,
  options: { allowLegacy?: boolean } = {},
): TierResolution | null {
  const entry =
    matchPriceEntry(amount, CURRENT_PRICE_ENTRIES) ??
    (options.allowLegacy ? matchPriceEntry(amount, LEGACY_PRICE_ENTRIES) : null);
  if (!entry) return null;
  return {
    tierName: entry.tierName,
    storageLimit: storageLimitForTier(entry.tierName),
    uploadLimit: maxUploadBytesForTier(entry.tierName),
    months: entry.months,
  };
}

/**
 * Return the per-upload byte ceiling for a given tier.
 */
export function maxUploadBytesForTier(tier: string): number {
  switch (tier) {
    case 'TIER4': return TIER4_MAX_UPLOAD_BYTES;
    case 'TIER3': return TIER3_MAX_UPLOAD_BYTES;
    case 'TIER2': return TIER2_MAX_UPLOAD_BYTES;
    case 'PREMIUM': return TIER2_MAX_UPLOAD_BYTES; // backward compat
    case 'TIER1': return TIER1_MAX_UPLOAD_BYTES;
    default: return FREE_MAX_UPLOAD_BYTES;
  }
}

/** Default PiRC2 billing interval: 30 days per cycle. */
export const PREMIUM_BILLING_INTERVAL_DAYS = 30;

/** Default PiRC2 billing horizon: allowance authorizes up to 12 monthly cycles. */
export const PREMIUM_DEFAULT_CYCLES_AUTHORIZED = 12;

/** IPFS CID version used when pinning content */
export const IPFS_CID_VERSION = 1 as const;
