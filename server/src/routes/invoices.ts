import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';
import { normalizePiEnv } from '../utils/piEnv';
import { prisma } from '../utils/prismaClient';
import { priceInvoiceInPi, InvoiceNotFoundError } from '../services/invoiceService';

export const invoicesRouter = Router();
invoicesRouter.use(piAuthMiddleware);

interface InvoiceRow {
  id: string;
  plan: string;
  status: string;
  currency: string;
  subscriptionCents: number;
  overageCents: number;
  overageSource: string;
  totalCents: number;
  cycleStart: Date;
  cycleEnd: Date;
  dueAt: Date;
  graceUntil: Date;
  paidAt: Date | null;
  createdAt: Date;
}

/** Dollar-canonical view — never exposes provider ids or internal link fields. */
function toPublicInvoice(inv: InvoiceRow) {
  return {
    id: inv.id,
    plan: inv.plan,
    status: inv.status,
    currency: inv.currency,
    subscriptionCents: inv.subscriptionCents,
    overageCents: inv.overageCents,
    overageSource: inv.overageSource,
    totalCents: inv.totalCents,
    cycleStart: inv.cycleStart,
    cycleEnd: inv.cycleEnd,
    dueAt: inv.dueAt,
    graceUntil: inv.graceUntil,
    paidAt: inv.paidAt,
    createdAt: inv.createdAt,
  };
}

/** GET /api/invoices — the signed-in user's invoices (most recent first). */
invoicesRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const invoices = await prisma.invoice.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ invoices: invoices.map(toPublicInvoice) });
});

/** GET /api/invoices/:id — one of the user's invoices. */
invoicesRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const inv = await prisma.invoice.findFirst({
    where: { id: String(req.params.id), userId: req.user!.id },
  });
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }
  res.json({ invoice: toPublicInvoice(inv) });
});

/**
 * POST /api/invoices/:id/settle-quote — price the invoice in Pi for settlement.
 *
 * DISPLAY ONLY: returns a short-lived priced offer; it charges nothing and
 * grants nothing. Returns an honest 503 when no live Pi/USD price is available.
 */
invoicesRouter.post(
  '/:id/settle-quote',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const schema = z.object({ env: z.enum(['testnet', 'mainnet']).optional() });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request.' });
      return;
    }
    const owned = await prisma.invoice.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
      select: { id: true, status: true },
    });
    if (!owned) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    if (owned.status === 'PAID') {
      res.status(409).json({ error: 'Invoice is already paid.' });
      return;
    }
    try {
      const env = normalizePiEnv(parsed.data.env);
      const quote = await priceInvoiceInPi(owned.id, env);
      res.json({
        quote: {
          id: quote.id,
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
      if (err instanceof InvoiceNotFoundError) {
        res.status(404).json({ error: err.message });
        return;
      }
      logger.error('Failed to price invoice for settlement', { error: err });
      res.status(500).json({ error: 'Failed to price invoice' });
    }
  },
);
