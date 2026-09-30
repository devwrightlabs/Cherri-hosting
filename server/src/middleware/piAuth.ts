import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';

// ─── LOCAL TEST SEAM (dev-auth) ───────────────────────────────────────────────
//
// NEVER active in production. Requires BOTH:
//   CHERRI_DEV_AUTH=1   AND   NODE_ENV !== 'production'
//
// Token format: "dev:<piUserId>:<username>"
// Example:      "dev:pioneer_test:pioneer_test"
//
// This seam upserts/loads the user by piUserId and skips the api.minepi.com
// call, enabling headless testing without a real Pi Browser session. There is
// NO way to activate it in production — the dual guard makes that impossible.
// ─────────────────────────────────────────────────────────────────────────────
async function tryDevAuth(
  req: AuthenticatedRequest,
  token: string,
): Promise<boolean> {
  // HARD guards: both must be true or we refuse immediately.
  if (process.env.CHERRI_DEV_AUTH !== '1') return false;
  if (process.env.NODE_ENV === 'production') return false;

  if (!token.startsWith('dev:')) return false;

  const parts = token.split(':');
  if (parts.length < 3) return false;

  const [, piUserId, ...usernameParts] = parts;
  const username = usernameParts.join(':');

  if (!piUserId || !username) return false;

  // Upsert the user so the seam is idempotent across test runs.
  const user = await prisma.user.upsert({
    where: { piUserId },
    update: { username },
    create: { piUserId, username },
  });

  req.user = {
    id: user.id,
    piUserId: user.piUserId,
    username: user.username,
    tier: user.tier,
  };

  logger.warn('[DEV-AUTH SEAM] Authenticated via dev token — NOT for production use', {
    piUserId,
    username,
  });
  return true;
}


export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    piUserId: string;
    username: string;
    tier: string;
  };
}

// App Studio checks the accessToken against the Pi Platform on our behalf and
// returns the *only* identity this app may trust. We must never call the Pi
// Platform's own /v2/me directly to authenticate a user, and never trust a
// uid/username supplied by the client itself (request body/query/header) —
// only what this verified exchange returns.
// Ref: https://pi-apps.github.io/pi-sdk-docs/quick-start/genai/Authentication
const APP_STUDIO_LOGIN_URL =
  'https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login';

interface AppStudioLoginResponse {
  sessionToken: string;
  user: {
    uid: string;
    username: string;
  };
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

  // ── Dev-auth seam (test only, dual-guarded, never reaches production) ──
  if (process.env.CHERRI_DEV_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    const handled = await tryDevAuth(req, accessToken);
    if (handled) { next(); return; }
  }

  try {
    // Exchange the client's Pi accessToken for a verified identity via App
    // Studio. App Studio checks the token against the Pi Platform itself, so
    // the uid/username it returns are the only identity this app may trust —
    // every downstream authorization decision (req.user.id/.tier/etc.) flows
    // from our own DB record keyed off this verified uid, never from a
    // client-supplied value. Do not call api.minepi.com/v2/me directly here.
    const appStudioResponse = await axios.post<AppStudioLoginResponse>(
      APP_STUDIO_LOGIN_URL,
      { accessToken },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
      },
    );

    const { uid, username } = appStudioResponse.data.user;

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
