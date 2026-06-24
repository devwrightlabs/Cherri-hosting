import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';
import { normalizePiEnv } from '../utils/piEnv';
import { PAID_PLAN_KEYS, PLAN_CATALOG } from '../utils/pricingCatalog';
import { createQuote, UnknownPlanError } from '../services/quoteService';

export const billingRouter = Router();
billingRouter.use(piAuthMiddleware);

/**
 * GET /api/billing/catalog — the dollar pricing catalog (display only).
 */
billingRouter.get('/catalog', (_req: AuthenticatedRequest, res: Response): void => {
  res.json({ currency: 'USD', plans: Object.values(PLAN_CATALOG) });
});

/**
 * POST /api/billing/quote — create a short-lived dollar-pegged Pi quote.
 *
 * Returns an honest 503 whenever a live Pi/USD price source is unavailable; it
 * never returns a guessed amount. This endpoint ONLY produces a priced offer —
 * it does not approve, complete, or grant any entitlement.
 */
billingRouter.post('/quote', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const schema = z.object({
    plan: z.enum(PAID_PLAN_KEYS as unknown as [string, ...string[]]),
    env: z.enum(['testnet', 'mainnet']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'A valid paid plan is required.' });
    return;
  }
  try {
    const env = normalizePiEnv(parsed.data.env);
    const quote = await createQuote({ userId: req.user!.id, plan: parsed.data.plan, env });
    res.json({
      quote: {
        id: quote.id,
        plan: quote.plan,
        dollarCents: quote.dollarCents,
        overageCents: quote.overageCents,
        piUsdRate: quote.piUsdRate,
        quotedPiAmount: quote.quotedPiAmount,
        source: quote.source,
        env: quote.env,
        expiresAt: quote.expiresAt,
      },
    });
  } catch (err) {
    if (err instanceof IntegrationUnavailableError) {
      res.status(503).json({ error: err.message, integration: err.integration });
      return;
    }
    if (err instanceof UnknownPlanError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error('Failed to create billing quote', { error: err });
    res.status(500).json({ error: 'Failed to create billing quote' });
  }
});
