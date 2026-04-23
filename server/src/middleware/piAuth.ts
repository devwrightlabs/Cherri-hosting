import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    piUserId: string;
    username: string;
    tier: string;
  };
}

interface PiMeResponse {
  uid: string;
  username: string;
}

export async function piAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const accessToken = authHeader.slice(7);

  try {
    // Verify token with Pi Platform API
    const piResponse = await axios.get<PiMeResponse>(
      'https://api.minepi.com/v2/me',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 8000,
      },
    );

    const { uid, username } = piResponse.data;

    // Find or create user
    let user = await prisma.user.findUnique({ where: { piUserId: uid } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          piUserId: uid,
          username,
        },
      });
      logger.info('New user created via Pi auth', { piUserId: uid, username });
    }

    req.user = {
      id: user.id,
      piUserId: user.piUserId,
      username: user.username,
      tier: user.tier,
    };

    next();
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      res.status(401).json({ error: 'Invalid Pi access token' });
      return;
    }
    logger.error('Pi auth middleware error', { error: err });
    res.status(500).json({ error: 'Authentication service unavailable' });
  }
}
