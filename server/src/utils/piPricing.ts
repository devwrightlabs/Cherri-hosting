/**
 * Pure dollar->Pi conversion + payment-amount verification math (Phase 5).
 *
 * No I/O, no price fetching, no clock dependence beyond an injectable `now`.
 * The live Pi/USD rate is supplied by services/piPriceService — this module
 * NEVER guesses a price; given a bad/zero/negative rate it throws so the caller
 * can fail honestly.
 */
import { BILLING_BUFFER_BPS } from './pricingCatalog';

/** Pi inherits Stellar's 7-decimal precision (1 stroop = 1e-7 Pi). */
export const PI_DECIMALS = 7;
const PI_SCALE = 10 ** PI_DECIMALS;

/** One stroop — the smallest Pi unit; the float-comparison epsilon. */
export const PI_EPSILON = 1 / PI_SCALE;

export class InvalidPriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPriceError';
  }
}

export interface PiOwedInput {
  /** Dollar subtotal in integer cents (>= 0). */
  usdCents: number;
  /** Live Pi price in USD (> 0, finite). */
  piUsd: number;
  /** Conversion buffer in basis points (>= 0). Defaults to ~4%. */
  bufferBps?: number;
}

/**
 * Pi owed = (usd / piUsd) * (1 + buffer), rounded UP to 7 dp so rounding can
 * never UNDER-charge. Throws InvalidPriceError on a missing/zero/negative price
 * or a bad dollar amount — callers must surface that as an honest failure and
 * never substitute a guessed price.
 */
export function computePiOwed({
  usdCents,
  piUsd,
  bufferBps = BILLING_BUFFER_BPS,
}: PiOwedInput): number {
  if (!Number.isInteger(usdCents) || usdCents < 0) {
    throw new InvalidPriceError('usdCents must be a non-negative integer.');
  }
  if (!Number.isFinite(piUsd) || piUsd <= 0) {
    throw new InvalidPriceError('Pi/USD price must be a positive, finite number.');
  }
  if (!Number.isFinite(bufferBps) || bufferBps < 0) {
    throw new InvalidPriceError('bufferBps must be a non-negative, finite number.');
  }
  if (usdCents === 0) return 0;
  // Owed stroops = (usdCents/100 / piUsd) * (1 + bufferBps/10000) * 1e7
  //             = usdCents * (10000 + bufferBps) * 10 / piUsd.
  // The numerator is an EXACT integer for integer inputs, so the only floating
  // operation is the single division by the live rate. We always ceil to whole
  // stroops, so rounding can never UNDER-charge — at worst it over-charges by
  // one stroop. (A subtractive epsilon was wrong: it could round DOWN a stroop.)
  const numerator = usdCents * (10000 + bufferBps) * 10;
  const stroops = Math.ceil(numerator / piUsd);
  return stroops / PI_SCALE;
}

export interface AmountCheck {
  ok: boolean;
  reason: 'ok' | 'underpaid' | 'overpaid';
}

/**
 * Compare a paid Pi amount against the quoted amount.
 *
 * Underpayment (more than one stroop short) is NEVER ok — it must not grant any
 * entitlement. Overpayment (more than one stroop over) is flagged separately so
 * the caller can apply its own refund/reject policy; it never auto-grants a
 * higher tier. Only a match within a stroop is `ok`.
 */
export function checkPaidPiAmount(quotedPiAmount: number, paidPiAmount: number): AmountCheck {
  if (!Number.isFinite(quotedPiAmount) || quotedPiAmount <= 0) {
    throw new InvalidPriceError('quotedPiAmount must be a positive, finite number.');
  }
  if (!Number.isFinite(paidPiAmount) || paidPiAmount < 0) {
    throw new InvalidPriceError('paidPiAmount must be a non-negative, finite number.');
  }
  if (paidPiAmount < quotedPiAmount - PI_EPSILON) return { ok: false, reason: 'underpaid' };
  if (paidPiAmount > quotedPiAmount + PI_EPSILON) return { ok: false, reason: 'overpaid' };
  return { ok: true, reason: 'ok' };
}

/** A quote is usable only strictly before its expiry instant. */
export function isQuoteExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}
