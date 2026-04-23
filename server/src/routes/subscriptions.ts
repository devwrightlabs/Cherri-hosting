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

export const subscriptionsRouter = Router();

subscriptionsRouter.use(piAuthMiddleware);

const PREMIUM_PRICE_PI = 10;
const PREMIUM_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10 GB

/**
 * GET /api/subscriptions/current
 * Get the active subscription for the authenticated user.
 */
subscriptionsRouter.get('/current', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user!.id,
        status: 'active',
        periodEnd: { gte: new Date() },
      },
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
 * Step 1 of Pi payment flow: approve payment on the server.
 */
subscriptionsRouter.post('/payments/approve', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const schema = z.object({ paymentId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'paymentId is required' });
    return;
  }

  try {
    const payment = await approvePayment(parsed.data.paymentId);

    // Validate amount matches our pricing
    if (payment.amount < PREMIUM_PRICE_PI) {
      res.status(400).json({ error: 'Payment amount is insufficient' });
      return;
    }

    res.json({ success: true, payment });
  } catch (err) {
    logger.error('Failed to approve payment', { error: err });
    res.status(500).json({ error: 'Failed to approve payment' });
  }
});

/**
 * POST /api/subscriptions/payments/complete
 * Step 2 of Pi payment flow: complete payment and upgrade user tier.
 */
subscriptionsRouter.post('/payments/complete', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const schema = z.object({
    paymentId: z.string().min(1),
    txid: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'paymentId and txid are required' });
    return;
  }

  try {
    const { paymentId, txid } = parsed.data;
    await completePayment(paymentId, txid);

    const isVerified = await verifyPayment(paymentId);
    if (!isVerified) {
      res.status(400).json({ error: 'Payment could not be verified on-chain' });
      return;
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    // Create subscription record
    const subscription = await prisma.subscription.create({
      data: {
        userId: req.user!.id,
        tier: 'PREMIUM',
        piTxId: txid,
        amount: PREMIUM_PRICE_PI,
        currency: 'Pi',
        status: 'active',
        periodStart: now,
        periodEnd,
      },
    });

    // Upgrade user
    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        tier: 'PREMIUM',
        storageLimit: BigInt(PREMIUM_STORAGE_LIMIT),
      },
    });

    logger.info('User upgraded to PREMIUM', { userId: req.user!.id, txid });
    res.json({ success: true, subscription });
  } catch (err) {
    logger.error('Failed to complete payment', { error: err });
    res.status(500).json({ error: 'Failed to complete payment' });
  }
});

/**
 * POST /api/subscriptions/cancel
 * Cancel the active subscription.
 */
subscriptionsRouter.post('/cancel', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await prisma.subscription.updateMany({
      where: { userId: req.user!.id, status: 'active' },
      data: { status: 'cancelled' },
    });

    await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        tier: 'FREE',
        storageLimit: BigInt(500 * 1024 * 1024),
      },
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to cancel subscription', { error: err });
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});
