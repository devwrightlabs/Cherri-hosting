/**
 * PiRC2 recurring-subscription routes.
 *
 *   POST /api/subscriptions/pirc2/subscribe  — record a verified one-time
 *        allowance approval and open a subscription. Access is NOT granted here;
 *        it follows the first successful on-chain charge done by the scheduler.
 *   POST /api/subscriptions/pirc2/cancel     — cancel + revoke access immediately.
 *   GET  /api/subscriptions/pirc2/current    — current subscription + events.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';
import {
  verifyAllowanceApproval,
  revokeAllowance,
} from '../services/pirc2Service';
import {
  revokePremiumAccess,
  recordBillingEvent,
} from '../services/subscriptionAccess';
import {
  PREMIUM_PRICE_PI,
  PREMIUM_BILLING_INTERVAL_DAYS,
  PREMIUM_DEFAULT_CYCLES_AUTHORIZED,
} from '../utils/constants';

export const pirc2Router = Router();

pirc2Router.use(piAuthMiddleware);

/** Active-ish statuses that should block opening a second subscription. */
const LIVE_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'PAST_DUE'];

/** Serialize a PiSubscription for JSON (Decimal → string, Date → ISO). */
function serializeSubscription(
  sub: Prisma.PiSubscriptionGetPayload<{ include: { events: true } }> | null,
) {
  if (!sub) return null;
  return {
    id: sub.id,
    tier: sub.tier,
    status: sub.status,
    subscriberAddress: sub.subscriberAddress,
    contractId: sub.contractId,
    onChainServiceId: sub.onChainServiceId,
    onChainSubId: sub.onChainSubId,
    approvalTxId: sub.approvalTxId,
    currency: sub.currency,
    amountPerCycle: sub.amountPerCycle.toString(),
    allowanceTotal: sub.allowanceTotal.toString(),
    allowanceRemaining: sub.allowanceRemaining.toString(),
    intervalDays: sub.intervalDays,
    cyclesAuthorized: sub.cyclesAuthorized,
    cyclesBilled: sub.cyclesBilled,
    currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    nextBillingAt: sub.nextBillingAt?.toISOString() ?? null,
    createdAt: sub.createdAt.toISOString(),
    events: (sub.events ?? [])
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        amount: e.amount ? e.amount.toString() : null,
        txId: e.txId,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
      })),
  };
}

/**
 * GET /current — the user's current (or most recent) PiRC2 subscription.
 */
pirc2Router.get('/current', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const sub = await prisma.piSubscription.findFirst({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { events: true },
    });
    res.json({ subscription: serializeSubscription(sub) });
  } catch (err) {
    logger.error('Failed to load PiRC2 subscription', { error: err });
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

/**
 * POST /subscribe — open a subscription from a verified allowance approval.
 */
pirc2Router.post('/subscribe', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const schema = z.object({
    approvalTxId: z.string().min(1),
    subscriberAddress: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'approvalTxId and subscriberAddress are required' });
    return;
  }

  const { approvalTxId, subscriberAddress } = parsed.data;

  // Billing terms are fixed server-side — never trust client-supplied pricing.
  const amountPerCycle = PREMIUM_PRICE_PI;
  const intervalDays = PREMIUM_BILLING_INTERVAL_DAYS;
  const cyclesAuthorized = PREMIUM_DEFAULT_CYCLES_AUTHORIZED;

  try {
    // Reject a duplicate active subscription for this user.
    const existing = await prisma.piSubscription.findFirst({
      where: { userId: req.user!.id, status: { in: LIVE_STATUSES } },
    });
    if (existing) {
      res.status(409).json({ error: 'You already have an active subscription.' });
      return;
    }

    // Verify the one-time allowance approval on-chain (throws 503 if PiRC2 off).
    const verification = await verifyAllowanceApproval({ approvalTxId, subscriberAddress });
    if (!verification.verified) {
      res.status(400).json({ error: 'Allowance approval could not be verified on-chain.' });
      return;
    }

    // Fail closed: the service id that drives every future on-chain draw must be
    // decoded from the verified subscribe() tx itself. We never trust a
    // client-supplied service id to route a real charge. If it could not be
    // decoded, the subscription is not billable and we refuse to open it.
    const onChainServiceId = verification.serviceId;
    const onChainSubId = verification.subId ?? null;
    if (!onChainServiceId) {
      res.status(422).json({
        error:
          'On-chain service id could not be decoded from the verified subscribe transaction; ' +
          'cannot open a billable subscription.',
      });
      return;
    }

    const perCycle = new Prisma.Decimal(amountPerCycle);
    const total = perCycle.mul(cyclesAuthorized);

    const sub = await prisma.piSubscription.create({
      data: {
        userId: req.user!.id,
        tier: 'PREMIUM',
        status: 'ACTIVE',
        subscriberAddress,
        contractId: process.env.PIRC2_CONTRACT_ID ?? null,
        onChainServiceId,
        onChainSubId,
        approvalTxId,
        currency: 'PI',
        amountPerCycle: perCycle,
        allowanceTotal: total,
        allowanceRemaining: total,
        intervalDays,
        cyclesAuthorized,
        cyclesBilled: 0,
        // Due immediately: the scheduler draws cycle 1, and access is granted
        // only after that charge succeeds.
        nextBillingAt: new Date(),
      },
      include: { events: true },
    });

    await recordBillingEvent({
      subscriptionId: sub.id,
      type: 'APPROVAL',
      status: 'SUCCESS',
      amount: perCycle,
      txId: approvalTxId,
      message: `Allowance approved for up to ${cyclesAuthorized} cycles of ${amountPerCycle} Pi.`,
    });

    logger.info('PiRC2 subscription opened', { userId: req.user!.id, subscriptionId: sub.id });
    res.json({ subscription: serializeSubscription(sub) });
  } catch (err) {
    if (err instanceof IntegrationUnavailableError) {
      res.status(503).json({ error: err.message, integration: err.integration });
      return;
    }
    logger.error('Failed to open PiRC2 subscription', { error: err });
    res.status(500).json({ error: 'Failed to open subscription' });
  }
});

/**
 * POST /cancel — cancel the current subscription and revoke access immediately.
 */
pirc2Router.post('/cancel', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const sub = await prisma.piSubscription.findFirst({
      where: { userId: req.user!.id, status: { in: LIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) {
      res.status(404).json({ error: 'No active subscription to cancel.' });
      return;
    }

    // Best-effort on-chain allowance revocation; never block cancellation on it.
    if (sub.subscriberAddress) {
      try {
        await revokeAllowance(sub.subscriberAddress);
      } catch (err) {
        logger.warn('PiRC2 on-chain allowance revoke skipped', {
          subscriptionId: sub.id,
          reason: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    await prisma.piSubscription.update({
      where: { id: sub.id },
      data: { status: 'CANCELLED', nextBillingAt: null },
    });
    await revokePremiumAccess(req.user!.id);
    await recordBillingEvent({
      subscriptionId: sub.id,
      type: 'CANCELLATION',
      status: 'SUCCESS',
      message: 'Subscription cancelled by user; access revoked.',
    });

    logger.info('PiRC2 subscription cancelled', { userId: req.user!.id, subscriptionId: sub.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to cancel PiRC2 subscription', { error: err });
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});
