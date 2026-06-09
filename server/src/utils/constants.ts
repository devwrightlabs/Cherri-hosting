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

/** Tier prices in Pi / month */
export const PREMIUM_PRICE_PI = 10;
export const TIER1_PRICE_PI = 17;
export const TIER2_PRICE_PI = 35;
export const TIER3_PRICE_PI = 88;
export const TIER4_PRICE_PI = 125;

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

/**
 * Resolve subscription tier name + storage limit from a Pi payment amount.
 * Returns null when the amount doesn't match any valid plan.
 */
export function resolveTierFromAmount(
  amount: number,
): { tierName: string; storageLimit: number; uploadLimit: number } | null {
  if (amount >= TIER4_PRICE_PI)
    return { tierName: 'TIER4', storageLimit: TIER4_STORAGE_LIMIT_BYTES, uploadLimit: TIER4_MAX_UPLOAD_BYTES };
  if (amount >= TIER3_PRICE_PI)
    return { tierName: 'TIER3', storageLimit: TIER3_STORAGE_LIMIT_BYTES, uploadLimit: TIER3_MAX_UPLOAD_BYTES };
  if (amount >= TIER2_PRICE_PI)
    return { tierName: 'TIER2', storageLimit: TIER2_STORAGE_LIMIT_BYTES, uploadLimit: TIER2_MAX_UPLOAD_BYTES };
  if (amount >= TIER1_PRICE_PI)
    return { tierName: 'TIER1', storageLimit: TIER1_STORAGE_LIMIT_BYTES, uploadLimit: TIER1_MAX_UPLOAD_BYTES };
  if (amount >= PREMIUM_PRICE_PI)
    return { tierName: 'TIER2', storageLimit: TIER2_STORAGE_LIMIT_BYTES, uploadLimit: TIER2_MAX_UPLOAD_BYTES }; // backward compat
  return null;
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
