import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import {
  getPayment,
  completePayment,
  verifyPayment,
} from '../services/piPaymentService';
import { logger } from '../utils/logger';
import {
  PREMIUM_PRICE_PI,
  PREMIUM_STORAGE_LIMIT_BYTES,
} from '../utils/constants';

export const paymentsRouter = Router();

paymentsRouter.use(piAuthMiddleware);

/**
 * POST /api/payments/verify
 * Verify an incomplete Pi Network payment found during SDK authentication.
 * This is called by the frontend `onIncompletePaymentFound` callback to recover
 * any payment whose transaction was submitted but not yet developer-completed.
 */
paymentsRouter.post('/verify', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const schema = z.object({ paymentId: z.string().min(1) });
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: 'paymentId is required' });
    return;
  }

  const { paymentId } = parsed.data;

  try {
    const payment = await getPayment(paymentId);

    // Cancelled or user-cancelled payments can be ignored
    if (payment.status.cancelled || payment.status.user_cancelled) {
      res.json({ status: 'cancelled' });
      return;
    }

    // Payment already fully completed — nothing to do
    if (payment.status.developer_completed) {
      res.json({ status: 'already_completed' });
      return;
    }

    // Payment has an on-chain transaction but was not yet completed on our side
    if (payment.transaction?.txid) {
      const txid = payment.transaction.txid;

      await completePayment(paymentId, txid);

      const isVerified = await verifyPayment(paymentId);
      if (!isVerified) {
        res.status(400).json({ error: 'Payment could not be verified on-chain' });
        return;
      }

      if (payment.amount < PREMIUM_PRICE_PI) {
        res.status(400).json({ error: 'Payment amount is insufficient' });
        return;
      }

      // Check if a subscription record already exists for this txid to avoid duplicates
      const existing = await prisma.subscription.findUnique({
        where: { piTxId: txid },
      });

      if (!existing) {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await prisma.subscription.create({
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
      }

      // Upgrade user tier if they are not already PREMIUM
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { tier: true },
      });

      if (user?.tier !== 'PREMIUM') {
        await prisma.user.update({
          where: { id: req.user!.id },
          data: {
            tier: 'PREMIUM',
            storageLimit: BigInt(PREMIUM_STORAGE_LIMIT_BYTES),
          },
        });
      }

      logger.info('Incomplete payment recovered and user upgraded', {
        userId: req.user!.id,
        paymentId,
        txid,
      });

      res.json({ status: 'completed' });
      return;
    }

    // Payment exists but has no transaction yet — nothing to recover on the server
    res.json({ status: 'pending' });
  } catch (err) {
    logger.error('Failed to verify payment', { paymentId, error: err });
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});
