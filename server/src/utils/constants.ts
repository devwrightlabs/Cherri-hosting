/** Free tier storage limit: 500 MB */
export const FREE_STORAGE_LIMIT_BYTES = 524_288_000;

/** Premium tier storage limit: 10 GB */
export const PREMIUM_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

/** Free tier maximum size per single upload: 50 MB */
export const FREE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Premium tier maximum size per single upload: 1 GB */
export const PREMIUM_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

/** Premium plan price in Pi */
export const PREMIUM_PRICE_PI = 10;

/** Default PiRC2 billing interval: 30 days per cycle. */
export const PREMIUM_BILLING_INTERVAL_DAYS = 30;

/** Default PiRC2 billing horizon: allowance authorizes up to 12 monthly cycles. */
export const PREMIUM_DEFAULT_CYCLES_AUTHORIZED = 12;

/** IPFS CID version used when pinning content */
export const IPFS_CID_VERSION = 1 as const;
