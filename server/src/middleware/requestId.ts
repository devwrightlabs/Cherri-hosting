/**
 * Per-request correlation ID middleware.
 *
 * Attaches a UUID to `req.requestId` and echoes it on every response via
 * `X-Request-Id` so clients and ops can correlate logs with specific requests.
 * The central error handler also injects it into error response payloads.
 */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  // Augment the Express Request type so downstream code has type-safe access.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id = crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
