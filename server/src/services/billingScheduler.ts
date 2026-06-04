/**
 * PiRC2 recurring-billing scheduler.
 *
 * On each tick it:
 *   1. Expires subscriptions whose paid period has ended without renewal.
 *   2. Charges subscriptions whose nextBillingAt is due, via the PiRC2 adapter.
 *
 * Outcome handling:
 *   - success            → record CHARGE, advance the period + allowance, grant
 *                          access; once the horizon is reached billing stops.
 *   - InsufficientFunds  → mark PAST_DUE and revoke access immediately.
 *   - IntegrationUnavailable → leave the subscription untouched and retry next
 *                          tick (a server-config gap must not penalise the user).
 *
 * The loop is fully guarded so a single bad subscription or a transient chain
 * error can never crash the process.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { isPirc2Configured, IntegrationUnavailableError } from '../utils/integrations';
import { chargeCycle, InsufficientFundsError } from './pirc2Service';
import {
  grantPremiumAccess,
  revokePremiumAccess,
  recordBillingEvent,
} from './subscriptionAccess';

let started = false;

/** While a cycle is being processed the row is "claimed" by pushing its
 *  nextBillingAt this far into the future, so a concurrent tick/instance skips
 *  it. If processing aborts (e.g. integration unavailable) the claim simply
 *  expires and the cycle is retried after this window. */
const CLAIM_LOCK_MS = 5 * 60_000;

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

/** Revoke access for an expired/cancelled subscription's user. */
async function expireSubscription(
  sub: { id: string; userId: string },
  reason: 'EXPIRY',
): Promise<void> {
  await prisma.piSubscription.update({
    where: { id: sub.id },
    data: { status: 'EXPIRED', nextBillingAt: null },
  });
  await revokePremiumAccess(sub.userId);
  await recordBillingEvent({
    subscriptionId: sub.id,
    type: reason,
    status: 'SUCCESS',
    message: 'Subscription reached the end of its authorized billing horizon.',
  });
  logger.info('PiRC2 subscription expired', { subscriptionId: sub.id });
}

type DueSub = Prisma.PiSubscriptionGetPayload<Record<string, never>>;

/** Attempt to bill one due subscription for a single cycle. */
async function billSubscription(sub: DueSub): Promise<void> {
  // Horizon reached: stop billing and let the current period run out.
  if (sub.cyclesBilled >= sub.cyclesAuthorized) {
    await prisma.piSubscription.update({
      where: { id: sub.id },
      data: { nextBillingAt: null },
    });
    return;
  }

  const amount = sub.amountPerCycle.toString();

  try {
    const { txId } = await chargeCycle({
      subscriberAddress: sub.subscriberAddress ?? '',
      cycleIndex: sub.cyclesBilled + 1,
      amount,
    });

    const periodStart = new Date();
    const periodEnd = addDays(periodStart, sub.intervalDays);
    const cyclesBilled = sub.cyclesBilled + 1;
    const reachedHorizon = cyclesBilled >= sub.cyclesAuthorized;
    const remaining = sub.allowanceRemaining.sub(sub.amountPerCycle);

    await prisma.piSubscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        cyclesBilled,
        allowanceRemaining: remaining.isNegative() ? new Prisma.Decimal(0) : remaining,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        nextBillingAt: reachedHorizon ? null : periodEnd,
      },
    });
    await grantPremiumAccess(sub.userId);
    await recordBillingEvent({
      subscriptionId: sub.id,
      type: sub.cyclesBilled === 0 ? 'CHARGE' : 'RENEWAL',
      status: 'SUCCESS',
      amount,
      txId,
      periodStart,
      periodEnd,
      message: `Cycle ${cyclesBilled} of ${sub.cyclesAuthorized} charged.`,
    });
    logger.info('PiRC2 cycle charged', { subscriptionId: sub.id, cyclesBilled, txId });
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      await prisma.piSubscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE', nextBillingAt: null },
      });
      await revokePremiumAccess(sub.userId);
      await recordBillingEvent({
        subscriptionId: sub.id,
        type: 'INSUFFICIENT_FUNDS',
        status: 'FAILED',
        amount,
        message: err.message,
      });
      logger.warn('PiRC2 cycle failed — insufficient funds, access revoked', {
        subscriptionId: sub.id,
      });
      return;
    }
    if (err instanceof IntegrationUnavailableError) {
      // Server-config gap: skip quietly and retry on a later tick.
      logger.debug('PiRC2 billing skipped — integration unavailable', {
        subscriptionId: sub.id,
      });
      return;
    }
    logger.error('PiRC2 billing error', { subscriptionId: sub.id, error: err });
  }
}

/** One scheduler pass. Safe to call repeatedly. */
export async function runBillingTick(): Promise<void> {
  const now = new Date();

  // 1. Expire subscriptions whose paid period ended and won't renew.
  const expired = await prisma.piSubscription.findMany({
    where: {
      status: 'ACTIVE',
      nextBillingAt: null,
      currentPeriodEnd: { lt: now },
    },
    select: { id: true, userId: true },
  });
  for (const sub of expired) {
    try {
      await expireSubscription(sub, 'EXPIRY');
    } catch (err) {
      logger.error('Failed to expire subscription', { subscriptionId: sub.id, error: err });
    }
  }

  // 2. Charge due subscriptions. Only meaningful when PiRC2 is configured;
  //    otherwise the adapter would raise IntegrationUnavailable for each.
  if (!isPirc2Configured()) return;

  const due = await prisma.piSubscription.findMany({
    where: { status: 'ACTIVE', nextBillingAt: { lte: now } },
  });
  for (const sub of due) {
    // Atomically claim the row so a concurrent tick/instance cannot bill the
    // same cycle. Only the worker whose update matches (still ACTIVE + still
    // due) proceeds.
    const claim = await prisma.piSubscription.updateMany({
      where: { id: sub.id, status: 'ACTIVE', nextBillingAt: { lte: now } },
      data: { nextBillingAt: new Date(Date.now() + CLAIM_LOCK_MS) },
    });
    if (claim.count !== 1) continue;
    await billSubscription(sub);
  }
}

/** Start the recurring billing loop once per process. */
export function startBillingScheduler(): void {
  if (started) return;
  started = true;
  const tickMs = Math.max(15_000, Number(process.env.BILLING_TICK_MS ?? 60_000));
  setInterval(() => {
    runBillingTick().catch((err) =>
      logger.error('Billing tick failed', { error: err }),
    );
  }, tickMs);
  logger.info('PiRC2 billing scheduler started', {
    tickMs,
    pirc2Configured: isPirc2Configured(),
  });
}
