/**
 * peggedPayment — a self-contained, product-agnostic dollar→Pi pegging engine.
 *
 * This is the ONE place that (1) turns a US-dollar target into the live Pi
 * amount to charge, and (2) validates a Pi amount actually paid against a
 * previously quoted amount. It deliberately knows NOTHING about Cherri plans,
 * Prisma, Express, entitlements, or subscriptions: feed it a dollar figure (in
 * integer cents) and it returns the Pi to charge; feed it a quoted-vs-paid pair
 * and it tells you whether the payment is acceptable. Drop it into any product
 * that needs "price in dollars, charge in Pi" — only the caller's glue (which
 * dollar figure, where to persist the quote, what to grant) is product-specific.
 *
 * Honesty guarantees (inherited from ../utils/piPricing + ./piPriceService):
 *  - NEVER invents a price. If no live Pi/USD rate is available the price lookup
 *    throws (callers surface an honest 503) — it never guesses or falls back.
 *  - NEVER under-charges. The dollar→Pi conversion always rounds UP to a whole
 *    stroop (1e-7 Pi), so rounding can only ever over-charge by a stroop.
 *  - Validation is EXACT (±1 stroop), never a percentage tolerance: the amount
 *    charged IS the quoted amount (the quote locks the rate for its lifetime),
 *    so any percentage slack would be a self-serve discount a tampered client
 *    could exploit, not legitimate "price movement".
 *
 * ── Inputs / outputs ──────────────────────────────────────────────────────────
 *   quotePeggedPi({ usdCents, bufferBps?, fetchPrice? }) -> Promise<PeggedQuote>
 *   expectedPiForTerm(perTermPiAmount, termMultiplier)    -> number
 *   validatePeggedPayment({ quotedPiAmount, paidPiAmount }) -> AmountCheck
 */
import {
  computePiOwed,
  checkPaidPiAmount,
  AmountCheck,
  PI_DECIMALS,
} from '../utils/piPricing';
import { BILLING_BUFFER_BPS } from '../utils/pricingCatalog';
import { getPiUsdPrice } from './piPriceService';

const PI_SCALE = 10 ** PI_DECIMALS;

/** A live Pi/USD observation (mirrors services/piPriceService.PiPrice). */
export interface PriceObservation {
  /** Pi price in USD (> 0). */
  piUsd: number;
  /** When the source last observed the rate. */
  observedAt: Date;
  /** Provider the rate came from (e.g. "coingecko"). */
  source: string;
}

/** Injectable live-price source. Defaults to the app's CoinGecko-backed lookup. */
export type PriceFetcher = () => Promise<PriceObservation>;

export interface QuotePeggedInput {
  /** Dollar target in integer US cents (>= 0). */
  usdCents: number;
  /** Conversion buffer in basis points (>= 0). Defaults to ~4%. */
  bufferBps?: number;
  /** Override the live-price source (for tests or other products). */
  fetchPrice?: PriceFetcher;
}

export interface PeggedQuote {
  usdCents: number;
  bufferBps: number;
  /** Pi to charge = (usd / piUsd) * (1 + buffer), rounded UP to 7 dp. */
  piAmount: number;
  /** The live rate this quote was priced at. */
  piUsd: number;
  observedAt: Date;
  source: string;
}

/**
 * Turn a dollar target into the live Pi amount to charge.
 *
 * Fetches a live Pi/USD rate (or uses the injected `fetchPrice`) and converts
 * with the never-under-charge ceil math. Propagates the price source's failure
 * (IntegrationUnavailableError → honest 503) — it never returns a guessed
 * amount.
 */
export async function quotePeggedPi({
  usdCents,
  bufferBps = BILLING_BUFFER_BPS,
  fetchPrice = getPiUsdPrice,
}: QuotePeggedInput): Promise<PeggedQuote> {
  const { piUsd, observedAt, source } = await fetchPrice();
  const piAmount = computePiOwed({ usdCents, piUsd, bufferBps });
  return { usdCents, bufferBps, piAmount, piUsd, observedAt, source };
}

/**
 * Scale a per-term (e.g. monthly) Pi amount by an integer term multiplier
 * (e.g. ×10 for an annual "two months free" plan), rounded to whole stroops.
 * The multiplier must be a positive integer so the result can never
 * under-charge relative to the per-term price.
 */
export function expectedPiForTerm(
  perTermPiAmount: number,
  termMultiplier: number,
): number {
  if (!Number.isFinite(perTermPiAmount) || perTermPiAmount < 0) {
    throw new Error('perTermPiAmount must be a non-negative, finite number.');
  }
  if (!Number.isInteger(termMultiplier) || termMultiplier <= 0) {
    throw new Error('termMultiplier must be a positive integer.');
  }
  return Math.round(perTermPiAmount * termMultiplier * PI_SCALE) / PI_SCALE;
}

export interface ValidatePeggedInput {
  /** The Pi amount that was quoted/offered (the price the user agreed to). */
  quotedPiAmount: number;
  /** The Pi amount actually paid (from the verified payment record). */
  paidPiAmount: number;
}

/**
 * Decide whether a paid Pi amount satisfies a quote. Underpayment (more than one
 * stroop short) is NEVER ok and must grant nothing; overpayment is reported
 * separately and must NOT be used to grant a higher entitlement. A match within
 * a stroop is `ok`.
 *
 * Intentionally exact (no percentage tolerance) — see the module header for why.
 */
export function validatePeggedPayment({
  quotedPiAmount,
  paidPiAmount,
}: ValidatePeggedInput): AmountCheck {
  return checkPaidPiAmount(quotedPiAmount, paidPiAmount);
}
