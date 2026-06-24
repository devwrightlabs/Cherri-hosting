/**
 * Dollar-canonical invoices (Phase 6 — overage + unpaid flow).
 *
 * An invoice is the source of truth for what a user owes for one billing cycle,
 * stored in integer cents. The Pi amount is produced on demand via the Phase 5
 * quote engine at settlement time; an unavailable Pi price never blocks RECORDING
 * the debt. Creating, pricing, or marking an invoice charges NOTHING — the real
 * Pi charge/settlement is the deferred cutover.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { PiEnv } from '../utils/piEnv';
import { BILLING_BUFFER_BPS } from '../utils/pricingCatalog';
import { computePiOwed } from '../utils/piPricing';
import { getPiUsdPrice } from './piPriceService';
import { resumeUserApps } from './appLifecycleService';
import { notifyOnce } from './notificationService';

/** Days after an invoice is due before unsettled apps may be paused. */
export const INVOICE_GRACE_DAYS = Math.max(0, Number(process.env.INVOICE_GRACE_DAYS ?? 7));
/** Minutes a settlement quote stays valid before it must be re-priced. */
export const QUOTE_TTL_MINUTES = 10;

export class InvoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Invoice "${id}" not found.`);
    this.name = 'InvoiceNotFoundError';
  }
}

export interface OverageResult {
  cents: number;
  source: string;
}

/**
 * Accrued overage for a billing cycle. Phase 4 metering does NOT exist yet, so
 * this honestly returns 0 tagged 'METERING_DEFERRED' — it never fabricates a
 * usage figure. Wiring real metered overage here is a Phase 4 task.
 */
export function computeOverageCents(_args: {
  userId: string;
  cycleStart: Date;
  cycleEnd: Date;
}): OverageResult {
  return { cents: 0, source: 'METERING_DEFERRED' };
}

export interface InvoiceTotals {
  subscriptionCents: number;
  overageCents: number;
  overageSource: string;
  totalCents: number;
}

export function buildInvoiceTotals(
  subscriptionCents: number,
  overage: OverageResult,
): InvoiceTotals {
  if (!Number.isInteger(subscriptionCents) || subscriptionCents < 0) {
    throw new Error('subscriptionCents must be a non-negative integer.');
  }
  if (!Number.isInteger(overage.cents) || overage.cents < 0) {
    throw new Error('overage.cents must be a non-negative integer.');
  }
  return {
    subscriptionCents,
    overageCents: overage.cents,
    overageSource: overage.source,
    totalCents: subscriptionCents + overage.cents,
  };
}

export interface CreateInvoiceInput {
  userId: string;
  plan: string;
  subscriptionCents: number;
  cycleStart: Date;
  cycleEnd: Date;
  dueAt?: Date;
  graceDays?: number;
  subscriptionId?: string;
  piSubscriptionId?: string;
}

/** Persist a dollar-canonical invoice (status OPEN). Charges nothing. */
export async function createInvoiceForPeriod(input: CreateInvoiceInput) {
  const overage = computeOverageCents({
    userId: input.userId,
    cycleStart: input.cycleStart,
    cycleEnd: input.cycleEnd,
  });
  const totals = buildInvoiceTotals(input.subscriptionCents, overage);
  const dueAt = input.dueAt ?? new Date();
  const graceDays = input.graceDays ?? INVOICE_GRACE_DAYS;
  const graceUntil = new Date(dueAt.getTime() + graceDays * 24 * 60 * 60 * 1000);

  return prisma.invoice.create({
    data: {
      userId: input.userId,
      subscriptionId: input.subscriptionId ?? null,
      piSubscriptionId: input.piSubscriptionId ?? null,
      plan: input.plan,
      cycleStart: input.cycleStart,
      cycleEnd: input.cycleEnd,
      subscriptionCents: totals.subscriptionCents,
      overageCents: totals.overageCents,
      overageSource: totals.overageSource,
      totalCents: totals.totalCents,
      status: 'OPEN',
      dueAt,
      graceUntil,
    },
  });
}

/**
 * Price an invoice's dollar total in Pi via the Phase 5 quote engine and link
 * the resulting quote to the invoice. DISPLAY ONLY: it produces a priced offer
 * for "settle balance", grants nothing, and charges nothing. Propagates
 * IntegrationUnavailableError (-> 503) when no live Pi/USD price is available.
 */
export async function priceInvoiceInPi(invoiceId: string, env: PiEnv) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new InvoiceNotFoundError(invoiceId);

  const { piUsd, observedAt, source } = await getPiUsdPrice();
  const quotedPiAmount = computePiOwed({
    usdCents: invoice.totalCents,
    piUsd,
    bufferBps: BILLING_BUFFER_BPS,
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUOTE_TTL_MINUTES * 60_000);

  const quote = await prisma.paymentQuote.create({
    data: {
      userId: invoice.userId,
      plan: invoice.plan,
      dollarCents: invoice.totalCents,
      overageCents: invoice.overageCents,
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
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { latestPaymentQuoteId: quote.id },
  });
  return quote;
}

/**
 * Mark an invoice settled and resume the user's apps. This is the SEAM the live
 * settlement cutover calls AFTER verifying a real Pi payment against the
 * invoice's quote — it must NEVER be invoked to fake a payment. Idempotent.
 */
export async function settleInvoice(
  invoiceId: string,
  settlement: { paymentId?: string; txid?: string; paidAt?: Date },
) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new InvoiceNotFoundError(invoiceId);
  if (invoice.status === 'PAID') return invoice;

  const paid = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'PAID',
      paidAt: settlement.paidAt ?? new Date(),
      paymentId: settlement.paymentId ?? null,
      txid: settlement.txid ?? null,
    },
  });
  const resume = await resumeUserApps(invoice.userId);
  if (resume.resumed > 0) {
    await notifyOnce({
      userId: invoice.userId,
      type: 'APPS_RESUMED',
      invoiceId: invoice.id,
      message: 'Your apps have been resumed after settlement.',
    });
  }
  logger.info('Invoice settled', {
    invoiceId: invoice.id,
    resumed: resume.resumed,
    pendingResume: resume.pendingResume,
  });
  return paid;
}
