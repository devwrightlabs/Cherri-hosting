/**
 * PiRC2 recurring-billing scheduler (contract-native BATCH model).
 *
 * On each tick it:
 *   1. Expires subscriptions whose paid period has ended without renewal.
 *   2. Draws due cycles on-chain. PiRC2's draw is a per-SERVICE batch call —
 *      `process(merchant, service_id, offset, limit)` — so we group due local
 *      subscriptions by their on-chain service id, page through `process` for
 *      that service, and reconcile each local row from the contract's
 *      authoritative per-subscriber `charge` / `chg_fail` events. We NEVER infer
 *      that a given subscriber was charged from the aggregate ProcessResult.
 *
 * Outcome handling per local row:
 *   - `charge` event   → record CHARGE/RENEWAL, advance period + allowance,
 *                        grant access; once the horizon is reached billing stops.
 *   - `chg_fail` event → mark PAST_DUE and revoke access immediately (the
 *                        contract itself disabled auto_renew on-chain).
 *   - no event         → the cycle is not yet due on-chain; back off and retry.
 *   - IntegrationUnavailable → leave rows untouched and retry next tick (a
 *                        server-config gap must not penalise the user).
 *
 * The loop is fully guarded so a single bad subscription or a transient chain
 * error can never crash the process.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { isPirc2Configured, IntegrationUnavailableError } from '../utils/integrations';
import { isBackendLaneLive } from './goLiveService';
import { processServicePage, ChargeEvent } from './pirc2Service';
import {
  grantPremiumAccess,
  revokePremiumAccess,
  recordBillingEvent,
} from './subscriptionAccess';

let started = false;

/** While a cycle is being processed the row is "claimed" by pushing its
 *  nextBillingAt this far into the future, so a concurrent tick/instance skips
 *  it. If processing aborts (e.g. integration unavailable) the claim is released
 *  and the cycle is retried on a later tick. */
const CLAIM_LOCK_MS = 5 * 60_000;

/** When a claimed row is not yet due on-chain (no event this pass), recheck it
 *  after this window instead of every tick, to avoid hammering the chain. */
const NOT_DUE_RETRY_MS = 5 * 60_000;

/** Max subscribers charged per `process` page, and a safety bound on paging. */
const PROCESS_PAGE_LIMIT = 50;
const MAX_PROCESS_OFFSET = 5_000;

function addDays(from: Date, days: number): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

type DueSub = Prisma.PiSubscriptionGetPayload<Record<string, never>>;

/** Revoke access for an expired subscription's user. */
async function expireSubscription(sub: { id: string; userId: string }): Promise<void> {
  await prisma.piSubscription.update({
    where: { id: sub.id },
    data: { status: 'EXPIRED', nextBillingAt: null },
  });
  await revokePremiumAccess(sub.userId);
  await recordBillingEvent({
    subscriptionId: sub.id,
    type: 'EXPIRY',
    status: 'SUCCESS',
    message: 'Subscription reached the end of its authorized billing horizon.',
  });
  logger.info('PiRC2 subscription expired', { subscriptionId: sub.id });
}

/** Release a claimed row so it is retried after the given delay. */
async function releaseClaim(sub: DueSub, delayMs: number): Promise<void> {
  await prisma.piSubscription.update({
    where: { id: sub.id },
    data: { nextBillingAt: new Date(Date.now() + delayMs) },
  });
}

/** Apply a successful on-chain charge to a local subscription row. */
async function applyCharge(sub: DueSub, event: ChargeEvent): Promise<void> {
  const amount = sub.amountPerCycle.toString();
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
    txId: event.txId,
    periodStart,
    periodEnd,
    message: `Cycle ${cyclesBilled} of ${sub.cyclesAuthorized} charged.`,
  });
  logger.info('PiRC2 cycle charged', { subscriptionId: sub.id, cyclesBilled, txId: event.txId });
}

/** Apply an on-chain charge failure (insufficient funds/allowance) to a row. */
async function applyChargeFailure(sub: DueSub, event: ChargeEvent): Promise<void> {
  await prisma.piSubscription.update({
    where: { id: sub.id },
    data: { status: 'PAST_DUE', nextBillingAt: null },
  });
  await revokePremiumAccess(sub.userId);
  await recordBillingEvent({
    subscriptionId: sub.id,
    type: 'INSUFFICIENT_FUNDS',
    status: 'FAILED',
    amount: sub.amountPerCycle.toString(),
    txId: event.txId,
    message:
      'On-chain charge failed (insufficient balance or allowance); auto-renew disabled.',
  });
  logger.warn('PiRC2 cycle failed — insufficient funds, access revoked', {
    subscriptionId: sub.id,
  });
}

/** Page through `process` for one service, collecting all per-subscriber events. */
async function drawServiceCharges(serviceId: string): Promise<ChargeEvent[]> {
  const events: ChargeEvent[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total && offset <= MAX_PROCESS_OFFSET) {
    const page = await processServicePage(serviceId, offset, PROCESS_PAGE_LIMIT);
    events.push(...page.events);
    total = page.result.total;
    if (total === 0) break;
    offset += PROCESS_PAGE_LIMIT;
  }
  return events;
}

/** Claim, draw and reconcile one service's due subscriptions. */
async function processServiceGroup(
  serviceId: string,
  rows: DueSub[],
  now: Date,
): Promise<void> {
  // Atomically claim each row so a concurrent tick/instance cannot reconcile the
  // same cycle. Only rows still ACTIVE + still due are claimed.
  const claimed: DueSub[] = [];
  for (const sub of rows) {
    const claim = await prisma.piSubscription.updateMany({
      where: { id: sub.id, status: 'ACTIVE', nextBillingAt: { lte: now } },
      data: { nextBillingAt: new Date(Date.now() + CLAIM_LOCK_MS) },
    });
    if (claim.count === 1) claimed.push(sub);
  }
  if (claimed.length === 0) return;

  let events: ChargeEvent[];
  try {
    events = await drawServiceCharges(serviceId);
  } catch (err) {
    // Config gap or transient chain error: release claims and retry next tick.
    if (!(err instanceof IntegrationUnavailableError)) {
      logger.error('PiRC2 batch draw failed', { serviceId, error: err });
    } else {
      logger.debug('PiRC2 batch draw skipped — integration unavailable', { serviceId });
    }
    for (const sub of claimed) await releaseClaim(sub, CLAIM_LOCK_MS).catch(() => undefined);
    return;
  }

  // Reconcile each claimed row from the authoritative per-subscriber events.
  for (const sub of claimed) {
    try {
      const addr = sub.subscriberAddress ?? '';
      const charged = events.find((e) => e.kind === 'charge' && e.subscriberAddress === addr);
      const failed = events.find((e) => e.kind === 'chg_fail' && e.subscriberAddress === addr);
      if (charged) {
        await applyCharge(sub, charged);
      } else if (failed) {
        await applyChargeFailure(sub, failed);
      } else {
        // Not due on-chain yet (contract skipped it): back off and recheck.
        await releaseClaim(sub, NOT_DUE_RETRY_MS);
      }
    } catch (err) {
      logger.error('PiRC2 reconcile error', { subscriptionId: sub.id, error: err });
    }
  }
}

/** One scheduler pass. Safe to call repeatedly. */
export async function runBillingTick(): Promise<void> {
  // GO-LIVE gate: nothing bills (charge or expire/revoke) until the operator
  // flips the master switch. Inert lane => no-op, zero chain calls.
  if (!(await isBackendLaneLive())) return;

  const now = new Date();

  // 1. Expire subscriptions whose paid period ended and won't renew.
  const expired = await prisma.piSubscription.findMany({
    where: { status: 'ACTIVE', nextBillingAt: null, currentPeriodEnd: { lt: now } },
    select: { id: true, userId: true },
  });
  for (const sub of expired) {
    try {
      await expireSubscription(sub);
    } catch (err) {
      logger.error('Failed to expire subscription', { subscriptionId: sub.id, error: err });
    }
  }

  // 2. Draw due subscriptions on-chain. Only meaningful when PiRC2 is
  //    configured; otherwise the adapter would raise IntegrationUnavailable.
  if (!isPirc2Configured()) return;

  const due = await prisma.piSubscription.findMany({
    where: {
      status: 'ACTIVE',
      nextBillingAt: { lte: now },
      onChainServiceId: { not: null },
    },
  });

  // Rows that have exhausted their authorized horizon: stop billing, let the
  // current paid period run out (they are excluded from the on-chain draw).
  const billable: DueSub[] = [];
  for (const sub of due) {
    if (sub.cyclesBilled >= sub.cyclesAuthorized) {
      await prisma.piSubscription
        .update({ where: { id: sub.id }, data: { nextBillingAt: null } })
        .catch((err) => logger.error('Failed to stop horizon-reached sub', { id: sub.id, err }));
      continue;
    }
    billable.push(sub);
  }

  // Group by on-chain service id; one batched `process` lane per service.
  const groups = new Map<string, DueSub[]>();
  for (const sub of billable) {
    const key = sub.onChainServiceId as string;
    const list = groups.get(key);
    if (list) list.push(sub);
    else groups.set(key, [sub]);
  }
  for (const [serviceId, rows] of groups) {
    try {
      await processServiceGroup(serviceId, rows, now);
    } catch (err) {
      logger.error('PiRC2 service group processing failed', { serviceId, error: err });
    }
  }
}

/** Start the recurring billing loop once per process. */
export function startBillingScheduler(): void {
  if (started) return;
  started = true;
  const tickMs = Math.max(15_000, Number(process.env.BILLING_TICK_MS ?? 60_000));
  setInterval(() => {
    runBillingTick().catch((err) => logger.error('Billing tick failed', { error: err }));
  }, tickMs);
  logger.info('PiRC2 billing scheduler started', {
    tickMs,
    pirc2Configured: isPirc2Configured(),
  });
}
