import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import {
  approvePayment,
  completePayment,
  verifyPayment,
} from '../services/piPaymentService';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';
import {
  FREE_STORAGE_LIMIT_BYTES,
  TIER1_PRICE_PI,
  resolveTierFromAmount,
} from '../utils/constants';

export const subscriptionsRouter = Router();
subscriptionsRouter.use(piAuthMiddleware);

/**
 * GET /api/subscriptions/current
 */
subscriptionsRouter.get('/current', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { userId: req.user!.id, status: 'active', periodEnd: { gte: new Date() } },
      orderBy: { periodEnd: 'desc' },
    });
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { tier: true, storageUsed: true, storageLimit: true },
    });
    res.json({ subscription, user });
  } catch (err) {
    logger.error('Failed to get subscription', { error: err });
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

/**
 * POST /api/subscriptions/payments/approve
 * Step 1: approve the Pi payment on the server side.
 */
subscriptionsRouter.post(
  '/payments/approve',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const schema = z.object({ paymentId: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'paymentId is required' });
      return;
    }
    try {
      const payment = await approvePayment(parsed.data.paymentId);
      if ((payment as { amount?: number }).amount !== undefined &&
          (payment as { amount: number }).amount < TIER1_PRICE_PI) {
        res.status(400).json({ error: 'Payment amount does not match any subscription plan.' });
        return;
      }
      res.json({ success: true, payment });
    } catch (err) {
      if (err instanceof IntegrationUnavailableError) {
        res.status(503).json({ error: err.message, integration: err.integration });
        return;
      }
      logger.error('Failed to approve payment', { error: err });
      res.status(500).json({ error: 'Failed to approve payment' });
    }
  },
);

/**
 * POST /api/subscriptions/payments/complete
 * Step 2: complete payment and upgrade user tier.
 *
 * The client must send `amount` (the Pi amount that was paid) alongside
 * paymentId + txid so the server can map it to the correct tier.
 */
subscriptionsRouter.post(
  '/payments/complete',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const schema = z.object({
      paymentId: z.string().min(1),
      txid: z.string().min(1),
      amount: z.number().positive(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'paymentId, txid, and amount are required' });
      return;
    }
    try {
      const { paymentId, txid, amount } = parsed.data;

      await completePayment(paymentId, txid);
      const isVerified = await verifyPayment(paymentId);
      if (!isVerified) {
        res.status(400).json({ error: 'Payment could not be verified on-chain' });
        return;
      }

      const tierInfo = resolveTierFromAmount(amount);
      if (!tierInfo) {
        res.status(400).json({ error: 'Payment amount does not match any subscription plan.' });
        return;
      }

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const subscription = await prisma.subscription.create({
        data: {
          userId: req.user!.id,
          tier: tierInfo.tierName,
          piTxId: txid,
          amount,
          currency: 'Pi',
          status: 'active',
          periodStart: now,
          periodEnd,
        },
      });

      await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          tier: tierInfo.tierName,
          storageLimit: BigInt(tierInfo.storageLimit),
        },
      });

      logger.info('User upgraded', { userId: req.user!.id, tier: tierInfo.tierName, txid });
      res.json({ success: true, subscription, tier: tierInfo.tierName });
    } catch (err) {
      if (err instanceof IntegrationUnavailableError) {
        res.status(503).json({ error: err.message, integration: err.integration });
        return;
      }
      logger.error('Failed to complete payment', { error: err });
      res.status(500).json({ error: 'Failed to complete payment' });
    }
  },
);

/**
 * POST /api/subscriptions/cancel
 */
subscriptionsRouter.post('/cancel', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await prisma.subscription.updateMany({
      where: { userId: req.user!.id, status: 'active' },
      data: { status: 'cancelled' },
    });
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { tier: 'FREE', storageLimit: BigInt(FREE_STORAGE_LIMIT_BYTES) },
    });
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to cancel subscription', { error: err });
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});
