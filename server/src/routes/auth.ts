import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

export const authRouter = Router();

const upsertUserSchema = z.object({
  piAccessToken: z.string().min(1),
  username: z.string().min(1),
});

/**
 * POST /api/auth/signin
 * Exchange Pi access token for a user profile.
 * Creates the user record if it does not exist.
 */
authRouter.post('/signin', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = upsertUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  // Delegate actual verification to the middleware by manually injecting the header
  req.headers.authorization = `Bearer ${parsed.data.piAccessToken}`;
  await piAuthMiddleware(req, res, async () => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication failed' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          piUserId: true,
          username: true,
          tier: true,
          storageUsed: true,
          storageLimit: true,
          createdAt: true,
        },
      });

      res.json({ user });
    } catch (err) {
      // Without this guard a DB failure here becomes an unhandled rejection and
      // the request hangs with no response. Always answer the client.
      logger.error('Failed to load user during signin', { error: err });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to sign in' });
      }
    }
  });
});

/**
 * GET /api/auth/me
 * Return the authenticated user's profile.
 */
authRouter.get('/me', piAuthMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        piUserId: true,
        username: true,
        tier: true,
        storageUsed: true,
        storageLimit: true,
        createdAt: true,
        _count: { select: { projects: true } },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (err) {
    logger.error('Failed to fetch user profile', { error: err });
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Pi-only apps must not collect email addresses. There is intentionally no
// PATCH /api/auth/me endpoint — user profile fields are Pi-authenticated
// only (piUserId, username) and are never user-editable via email-style
// contact info.
