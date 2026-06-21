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
  PRICING_V2_CUTOFF,
  resolveTierFromAmount,
} from '../utils/constants';
import { normalizePiEnv } from '../utils/piEnv';

export const paymentsRouter = Router();

paymentsRouter.use(piAuthMiddleware);

/**
 * POST /api/payments/verify
 * Recover an incomplete Pi payment found by the SDK during authenticate().
 *
 * Pi fires onIncompletePaymentFound when a payment was created in a previous
 * session but never reached developer_completed. We must never silently ignore
 * it — that would leave the user's Pi locked on-chain indefinitely.
 *
 * Recovery steps:
 *   1. Fetch the payment from the Pi Platform API.
 *   2. If not yet developer_approved  → approve it now.
 *   3. If transaction is on-chain     → complete it and activate the subscription.
 *   4. If no transaction yet          → return "pending" (Pi will retry later).
 */
paymentsRouter.post('/verify', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const schema = z.object({
    paymentId: z.string().min(1),
    env: z.enum(['testnet', 'mainnet']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'paymentId is required' });
    return;
  }

  const { paymentId } = parsed.data;
  const env = normalizePiEnv(parsed.data.env);

  try {
    const payment = await getPayment(paymentId, env);

    // Ownership — only the payer may recover/activate their own payment.
    if (payment.user_uid !== req.user!.piUserId) {
      logger.warn('Payment ownership mismatch', { paymentId, payer: payment.user_uid });
      res.status(403).json({ error: 'This payment belongs to a different account.' });
      return;
    }
    // Env — the env stamped in metadata at createPayment must match the request.
    const metaEnv = payment.metadata?.env;
    if (typeof metaEnv === 'string' && metaEnv !== env) {
      logger.warn('Payment env mismatch', { paymentId, requestEnv: env, metaEnv });
      res.status(400).json({ error: 'Payment environment mismatch.' });
      return;
    }

    // Cancelled payments — nothing to do, acknowledge so Pi can clean up
    if (payment.status.cancelled || payment.status.user_cancelled) {
      res.json({ status: 'cancelled' });
      return;
    }

    // Already fully processed — idempotent acknowledgement
    if (payment.status.developer_completed) {
      res.json({ status: 'already_completed' });
      return;
    }

    // Validate amount maps to a known plan before touching anything. Recovery is
    // the only path that may honour pre-v2 prices, and only for payments created
    // before the rollout cutoff — so the price increase can't be replayed by a
    // tampered client paying an old amount.
    const createdAt = payment.created_at ? new Date(payment.created_at) : null;
    const allowLegacy =
      createdAt !== null &&
      !Number.isNaN(createdAt.getTime()) &&
      createdAt < PRICING_V2_CUTOFF;
    const tierInfo = resolveTierFromAmount(payment.amount, { allowLegacy });
    if (!tierInfo) {
      res.status(400).json({ error: 'Payment amount does not match any subscription plan.' });
      return;
    }

    // Step 1 — approve if the server hasn't done so yet
    if (!payment.status.developer_approved) {
      await approvePayment(paymentId, env);
    }

    // Step 2 — if the on-chain transaction exists, complete and activate
    if (payment.transaction?.txid) {
      const txid = payment.transaction.txid;

      await completePayment(paymentId, txid, env);

      const isVerified = await verifyPayment(paymentId, env);
      if (!isVerified) {
        res.status(400).json({ error: 'Payment could not be verified on-chain' });
        return;
      }

      // Upsert subscription — guard against duplicate recovery calls
      const existing = await prisma.subscription.findUnique({ where: { piTxId: txid } });
      if (!existing) {
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + tierInfo.months);

        await prisma.subscription.create({
          data: {
            userId: req.user!.id,
            tier: tierInfo.tierName,
            piTxId: txid,
            amount: payment.amount,
            currency: 'Pi',
            status: 'active',
            env,
            periodStart: now,
            periodEnd,
          },
        });
      }

      // Upgrade the user only if the recovered tier is higher than their current one
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { tier: true },
      });
      if (user && user.tier !== tierInfo.tierName) {
        await prisma.user.update({
          where: { id: req.user!.id },
          data: {
            tier: tierInfo.tierName,
            storageLimit: BigInt(tierInfo.storageLimit),
          },
        });
      }

      logger.info('Incomplete payment recovered', {
        userId: req.user!.id,
        paymentId,
        txid,
        tier: tierInfo.tierName,
      });

      res.json({ status: 'completed', tier: tierInfo.tierName });
      return;
    }

    // Transaction not yet on-chain — Pi will call onIncompletePaymentFound again
    res.json({ status: 'pending' });
  } catch (err) {
    if (err instanceof IntegrationUnavailableError) {
      res.status(503).json({ error: err.message, integration: err.integration });
      return;
    }
    logger.error('Failed to verify payment', { paymentId, error: err });
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});
