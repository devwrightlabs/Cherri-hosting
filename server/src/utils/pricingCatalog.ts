/**
 * Dollar-anchored pricing catalog (WOODSTICK 3 Phase 5).
 *
 * Plans are priced in US DOLLARS; the Pi amount charged FLOATS off a live
 * Pi/USD rate at charge time (see ./piPricing + services/piPriceService). The
 * whole-dollar price of every PAID plan has digits that sum to 8 — a deliberate
 * brand property ("the 8"); the digits-sum-8 unit test guards it.
 *
 * This catalog is the source of truth for the NEW dollar pricing. The legacy
 * Pi-denominated constants in ./constants.ts stay intact so existing/in-flight
 * Pi payments and grandfathered subscriptions keep resolving — the live cutover
 * to dollar-pegged purchases (and the plan -> storage/upload entitlement
 * mapping) is a deliberately separate, later slice.
 */

export type PaidPlanKey = 'BUILDER' | 'PRO' | 'TIER4';
export type PlanKey = 'FREE' | PaidPlanKey;

export interface PlanDef {
  key: PlanKey;
  label: string;
  /** Monthly price anchor in whole US dollars. */
  usd: number;
  /** Same monthly price in integer US cents (the quote/charge unit). */
  usdCents: number;
}

export const PLAN_CATALOG: Record<PlanKey, PlanDef> = {
  FREE: { key: 'FREE', label: 'Free', usd: 0, usdCents: 0 },
  BUILDER: { key: 'BUILDER', label: 'Builder', usd: 35, usdCents: 3500 },
  PRO: { key: 'PRO', label: 'Pro', usd: 143, usdCents: 14300 },
  TIER4: { key: 'TIER4', label: 'Tier 4', usd: 350, usdCents: 35000 },
};

export const PAID_PLAN_KEYS: readonly PaidPlanKey[] = ['BUILDER', 'PRO', 'TIER4'];

/**
 * Entitlement each PAID catalog plan grants. The dollar catalog is the source of
 * truth for PRICE; the granted entitlement (storage/upload/domain limits and the
 * tier stored on the user) stays on the existing TIERn scale so enforcement is
 * completely unchanged.
 *
 * NOTE: the $350 plan is keyed `TIER4` in this catalog for historical reasons,
 * but it grants the 50 GB **TIER3** ("Business") entitlement — Cherri's current
 * top sold tier — NOT the 100 GB legacy TIER4. Keep this mapping authoritative:
 * the granted plan is always resolved from a server-stored quote's `plan`, never
 * from client-supplied metadata.
 */
export const PLAN_ENTITLEMENT_TIER: Record<PaidPlanKey, 'TIER1' | 'TIER2' | 'TIER3'> = {
  BUILDER: 'TIER1',
  PRO: 'TIER2',
  TIER4: 'TIER3',
};

/**
 * Phase 4 metering: network egress allowance (GB) included per plan, and the
 * overage rate in integer US cents per GB beyond the allowance. Overage is
 * metered off REAL sampled provider usage only — when no usage was sampled the
 * billing path charges 0 and tags METERING_UNAVAILABLE (never a guessed figure).
 * Operators can override the defaults via env without a code change.
 */
export const METERING_INCLUDED_GB: Record<PlanKey, number> = {
  FREE: Number(process.env.METERING_INCLUDED_GB_FREE ?? 0),
  BUILDER: Number(process.env.METERING_INCLUDED_GB_BUILDER ?? 100),
  PRO: Number(process.env.METERING_INCLUDED_GB_PRO ?? 500),
  TIER4: Number(process.env.METERING_INCLUDED_GB_TIER4 ?? 2000),
};

/** US cents charged per GB of network egress beyond a plan's included GB. */
export const METERING_OVERAGE_CENTS_PER_GB = Number(
  process.env.METERING_OVERAGE_CENTS_PER_GB ?? 10,
);

/** Included network egress (GB) for a plan key; 0 for unknown keys. */
export function includedNetworkGb(planKey: string): number {
  return Object.prototype.hasOwnProperty.call(METERING_INCLUDED_GB, planKey)
    ? METERING_INCLUDED_GB[planKey as PlanKey]
    : 0;
}

/** Default dollar->Pi conversion buffer (~4%) covering exchange slippage. */
export const BILLING_BUFFER_BPS = 400;

/** Sum of the base-10 digits of a non-negative integer. */
export function digitsSum(n: number): number {
  let rest = Math.abs(Math.trunc(n));
  let sum = 0;
  while (rest > 0) {
    sum += rest % 10;
    rest = Math.floor(rest / 10);
  }
  return sum;
}

export function isPaidPlanKey(key: string): key is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly string[]).includes(key);
}

/** Return a plan by key, or null if the key isn't in the catalog. */
export function getPlan(key: string): PlanDef | null {
  return Object.prototype.hasOwnProperty.call(PLAN_CATALOG, key)
    ? PLAN_CATALOG[key as PlanKey]
    : null;
}
