/**
 * Central Express error handler.
 *
 * Must be registered as the LAST middleware in Express (four-argument signature).
 * Produces a consistent `{ error: { code, message, requestId } }` envelope so
 * every error response has the same shape regardless of where it originated.
 *
 * Stack traces are NEVER leaked when NODE_ENV=production.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

function toEnvelope(
  code: string,
  message: string,
  requestId: string,
): ApiErrorEnvelope {
  return { error: { code, message, requestId } };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function centralErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.requestId ?? 'unknown';
  const isProd = process.env.NODE_ENV === 'production';

  // Known integration-unavailable errors → 503 with a clean message.
  if (err instanceof IntegrationUnavailableError) {
    logger.warn('Integration unavailable', {
      integration: err.integration,
      message: err.message,
      requestId,
    });
    res
      .status(503)
      .json(toEnvelope('INTEGRATION_UNAVAILABLE', err.message, requestId));
    return;
  }

  // Generic server error.
  logger.error('Unhandled error', {
    message: err.message,
    // Omit stack in production — never leak internals.
    stack: isProd ? undefined : err.stack,
    requestId,
    path: req.path,
    method: req.method,
  });

  res.status(500).json(
    toEnvelope(
      'INTERNAL_SERVER_ERROR',
      isProd ? 'Internal server error' : err.message,
      requestId,
    ),
  );
}
