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
