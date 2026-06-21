import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import {
  getPayment,
  approvePayment,
  completePayment,
  verifyPayment,
} from '../services/piPaymentService';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';
import {
  FREE_STORAGE_LIMIT_BYTES,
  PRICING_V2_CUTOFF,
  resolveTierFromAmount,
} from '../utils/constants';
import { normalizePiEnv } from '../utils/piEnv';

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
    const schema = z.object({
      paymentId: z.string().min(1),
      env: z.enum(['testnet', 'mainnet']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'paymentId is required' });
      return;
    }
    try {
      const env = normalizePiEnv(parsed.data.env);

      // Ownership — only the payer may approve their own payment.
      const payment = await getPayment(parsed.data.paymentId, env);
      if (payment.user_uid !== req.user!.piUserId) {
        logger.warn('Payment ownership mismatch', {
          paymentId: parsed.data.paymentId,
          payer: payment.user_uid,
        });
        res.status(403).json({ error: 'This payment belongs to a different account.' });
        return;
      }
      if (!resolveTierFromAmount(payment.amount)) {
        res.status(400).json({ error: 'Payment amount does not match any subscription plan.' });
        return;
      }

      const approved = await approvePayment(parsed.data.paymentId, env);
      res.json({ success: true, payment: approved });
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
      // Advisory only — the entitlement is derived from the server-verified
      // payment amount, never from this client-supplied value.
      amount: z.number().positive().optional(),
      env: z.enum(['testnet', 'mainnet']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'paymentId and txid are required' });
      return;
    }
    try {
      const { paymentId, txid, amount: clientAmount } = parsed.data;
      const env = normalizePiEnv(parsed.data.env);

      // Inspect the payment BEFORE completing it so we never developer-complete a
      // payment we won't honour. Enforce up front:
      //  1. Ownership — the payer (user_uid) must be the authenticated user.
      //  2. Env — the env stamped in metadata at createPayment must match.
      //  3. Amount — must map to a plan (grandfathering pre-cutoff legacy amounts).
      const pre = await getPayment(paymentId, env);
      if (pre.user_uid !== req.user!.piUserId) {
        logger.warn('Payment ownership mismatch', { paymentId, payer: pre.user_uid });
        res.status(403).json({ error: 'This payment belongs to a different account.' });
        return;
      }
      const preMetaEnv = pre.metadata?.env;
      if (typeof preMetaEnv === 'string' && preMetaEnv !== env) {
        logger.warn('Payment env mismatch', { paymentId, requestEnv: env, metaEnv: preMetaEnv });
        res.status(400).json({ error: 'Payment environment mismatch.' });
        return;
      }

      // Resolve the entitlement from the SERVER-fetched amount BEFORE completing,
      // so we never developer-complete a payment we can't honour. Legacy prices
      // are accepted only for payments created before the v2 cutoff — this
      // grandfathers old in-flight payments without reopening the underpayment
      // hole for new purchases.
      const preCreatedAt = pre.created_at ? new Date(pre.created_at) : null;
      const allowLegacy =
        preCreatedAt !== null &&
        !Number.isNaN(preCreatedAt.getTime()) &&
        preCreatedAt < PRICING_V2_CUTOFF;
      const tierInfo = resolveTierFromAmount(pre.amount, { allowLegacy });
      if (!tierInfo) {
        res.status(400).json({ error: 'Payment amount does not match any subscription plan.' });
        return;
      }

      // Step 2 — complete on the Pi Platform. The returned payment is the
      // authoritative record: its amount/payer come from Pi, not the client.
      const completed = await completePayment(paymentId, txid, env);
      const isVerified = await verifyPayment(paymentId, env);
      if (!isVerified) {
        res.status(400).json({ error: 'Payment could not be verified on-chain' });
        return;
      }

      // Re-assert ownership on the completed object (defense in depth).
      if (completed.user_uid !== req.user!.piUserId) {
        logger.warn('Completed payment ownership mismatch', { paymentId, payer: completed.user_uid });
        res.status(403).json({ error: 'This payment belongs to a different account.' });
        return;
      }

      // The completed record is authoritative; its amount must match what we
      // gated on before completing. A mismatch here is anomalous (Pi reporting a
      // different amount post-completion) — refuse rather than grant a tier the
      // payment didn't pay for.
      if (Math.abs(completed.amount - pre.amount) > 1e-6) {
        logger.error('Pi payment amount changed between inspect and complete', {
          paymentId,
          inspectedAmount: pre.amount,
          completedAmount: completed.amount,
        });
        res.status(400).json({ error: 'Payment amount inconsistency detected.' });
        return;
      }
      if (clientAmount !== undefined && clientAmount !== completed.amount) {
        logger.warn('Client/server payment amount mismatch', {
          paymentId,
          clientAmount,
          serverAmount: completed.amount,
        });
      }

      // Idempotency — Pi may retry the completion callback. If a subscription
      // already exists for this txid, return it instead of hitting the unique
      // piTxId constraint with a 500.
      const existing = await prisma.subscription.findUnique({ where: { piTxId: txid } });
      if (existing) {
        res.json({ success: true, subscription: existing, tier: existing.tier });
        return;
      }

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + tierInfo.months);

      const subscription = await prisma.subscription.create({
        data: {
          userId: req.user!.id,
          tier: tierInfo.tierName,
          piTxId: txid,
          amount: completed.amount,
          currency: 'Pi',
          status: 'active',
          env,
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
