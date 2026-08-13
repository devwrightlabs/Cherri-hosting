import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { logger } from '../utils/logger';
import {
  createTicket,
  listTickets,
  getTicket,
  addUserReply,
  closeTicket,
  SupportTicketValidationError,
  SupportTicketLimitError,
} from '../services/supportTicketService';

export const supportRouter = Router();
supportRouter.use(piAuthMiddleware);

function handleServiceError(err: unknown, res: Response, fallback: string): void {
  if (err instanceof SupportTicketValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof SupportTicketLimitError) {
    res.status(429).json({ error: err.message });
    return;
  }
  logger.error(fallback, { error: err });
  res.status(500).json({ error: fallback });
}

/** GET /api/support/tickets — the signed-in user's tickets, newest first. */
supportRouter.get('/tickets', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tickets = await listTickets(req.user!.id);
    res.json({ tickets });
  } catch (err) {
    handleServiceError(err, res, 'Failed to list support tickets');
  }
});

const createSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

/** POST /api/support/tickets — open a new ticket with an initial message. */
supportRouter.post('/tickets', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Subject and message are required' });
    return;
  }
  try {
    const ticket = await createTicket(req.user!.id, parsed.data.subject, parsed.data.body);
    res.status(201).json({ ticket });
  } catch (err) {
    handleServiceError(err, res, 'Failed to open support ticket');
  }
});

/** GET /api/support/tickets/:id — one ticket with its full message thread. */
supportRouter.get('/tickets/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const ticket = await getTicket(req.user!.id, String(req.params.id));
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    res.json({ ticket });
  } catch (err) {
    handleServiceError(err, res, 'Failed to load support ticket');
  }
});

const replySchema = z.object({ body: z.string().min(1) });

/** POST /api/support/tickets/:id/reply — add a follow-up message as the user. */
supportRouter.post(
  '/tickets/:id/reply',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }
    try {
      const ticket = await addUserReply(req.user!.id, String(req.params.id), parsed.data.body);
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }
      res.json({ ticket });
    } catch (err) {
      handleServiceError(err, res, 'Failed to reply to support ticket');
    }
  },
);

/** POST /api/support/tickets/:id/close — the user closes their own ticket. */
supportRouter.post(
  '/tickets/:id/close',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const ticket = await closeTicket(req.user!.id, String(req.params.id));
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }
      res.json({ ticket });
    } catch (err) {
      handleServiceError(err, res, 'Failed to close support ticket');
    }
  },
);
