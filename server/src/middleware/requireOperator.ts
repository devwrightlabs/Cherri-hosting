/**
 * Operator-only ("admin, me only") gate for the Phase 7 cost-control console.
 *
 * Honesty/security: this NEVER defaults to open. The operator is identified by
 * their Pi user id, listed in the OPERATOR_PI_USER_IDS env allowlist. With no
 * allowlist configured the endpoints return an honest 503 (feature not
 * configured) rather than letting any authenticated user in. Must run AFTER
 * piAuthMiddleware so req.user is populated.
 */
import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './piAuth';
import { logger } from '../utils/logger';

/** Operator Pi-user allowlist parsed from env (comma/space/newline separated). */
function operatorAllowlist(): string[] {
  return (process.env.OPERATOR_PI_USER_IDS ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOperatorConfigured(): boolean {
  return operatorAllowlist().length > 0;
}

export function isOperator(piUserId: string | undefined): boolean {
  if (!piUserId) return false;
  return operatorAllowlist().includes(piUserId);
}

export function requireOperator(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!isOperatorConfigured()) {
    res.status(503).json({
      error:
        'Operator console is not configured. Set OPERATOR_PI_USER_IDS to enable it.',
    });
    return;
  }
  if (!isOperator(req.user?.piUserId)) {
    logger.warn('Operator access denied', { piUserId: req.user?.piUserId });
    res.status(403).json({ error: 'Operator access required.' });
    return;
  }
  next();
}
