/**
 * Dollar-pegged Pi quote creation (Phase 5).
 *
 * A quote captures, at a single instant: the plan's dollar subtotal, the live
 * Pi/USD rate (and where/when it came from), the buffer applied, and the
 * resulting Pi amount owed — with a short expiry so a stale rate can't be paid
 * against. Producing a quote grants NOTHING; it is purely a priced offer.
 */
import { prisma } from '../utils/prismaClient';
import { PiEnv } from '../utils/piEnv';
import { getPlan, BILLING_BUFFER_BPS, isPaidPlanKey, PlanDef } from '../utils/pricingCatalog';
import { computePiOwed } from '../utils/piPricing';
import { getPiUsdPrice } from './piPriceService';

/** Minutes a quote stays valid before it must be re-fetched at a fresh rate. */
export const QUOTE_TTL_MINUTES = 10;

export class UnknownPlanError extends Error {
  constructor(plan: string) {
    super(`Unknown or non-purchasable plan "${plan}".`);
    this.name = 'UnknownPlanError';
  }
}

export interface CreateQuoteInput {
  userId: string;
  plan: string;
  env: PiEnv;
}

/**
 * Create a short-lived dollar-pegged Pi quote for a paid plan.
 *
 * Overage is always 0 here — usage metering (Phase 4) does not exist yet, so we
 * never fabricate an overage figure. Throws UnknownPlanError for non-paid plans
 * and propagates IntegrationUnavailableError from the price source (-> 503) when
 * no live Pi/USD rate is available; it never invents a price.
 */
export async function createQuote({ userId, plan, env }: CreateQuoteInput) {
  if (!isPaidPlanKey(plan)) {
    throw new UnknownPlanError(plan);
  }
  const def = getPlan(plan) as PlanDef;
  const overageCents = 0; // Phase 4 metering not built — never fabricated.
  const dollarCents = def.usdCents + overageCents;

  const { piUsd, observedAt, source } = await getPiUsdPrice();
  const quotedPiAmount = computePiOwed({
    usdCents: dollarCents,
    piUsd,
    bufferBps: BILLING_BUFFER_BPS,
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MINUTES * 60_000);

  return prisma.paymentQuote.create({
    data: {
      userId,
      plan,
      dollarCents,
      overageCents,
      piUsdRate: piUsd,
      source,
      observedAt,
      bufferBps: BILLING_BUFFER_BPS,
      quotedPiAmount,
      env,
      status: 'PENDING',
      expiresAt,
    },
  });
}
