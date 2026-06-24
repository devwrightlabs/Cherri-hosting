/**
 * Phase 7 operator-only cost-control console.
 *
 * Every route is behind piAuthMiddleware + requireOperator (Pi-id allowlist).
 * This is the "admin, me only" surface from the spec — it is never exposed to
 * end users and never leaks Railway identifiers beyond the operator.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { requireOperator } from '../middleware/requireOperator';
import { logger } from '../utils/logger';
import {
  getCostControlConfig,
  updateCostControlConfig,
  getCapStatus,
  listOperatorAlerts,
  markAllOperatorAlertsRead,
  CostControlValidationError,
} from '../services/costControlService';
import { getCostDashboard } from '../services/costDashboardService';

export const operatorCostControlRouter = Router();
operatorCostControlRouter.use(piAuthMiddleware, requireOperator);

/** Small wrapper so an async throw becomes an honest 500 rather than a hang. */
function handle(
  fn: (req: AuthenticatedRequest, res: Response) => Promise<void>,
) {
  return async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.error('Operator cost-control route error', {
        path: req.path,
        error: (err as Error).message,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

operatorCostControlRouter.get(
  '/config',
  handle(async (_req, res) => {
    res.json(await getCostControlConfig());
  }),
);

const patchSchema = z
  .object({
    maxLiveDbs: z.number().int().min(1).optional(),
    warnAtPercent: z.number().int().min(1).max(100).optional(),
    inactivityDays: z.number().int().min(1).optional(),
    snapshotDeleteEnabled: z.boolean().optional(),
  })
  .strict();

operatorCostControlRouter.patch(
  '/config',
  handle(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid config', details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await updateCostControlConfig(parsed.data));
    } catch (err) {
      if (err instanceof CostControlValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

operatorCostControlRouter.get(
  '/cap',
  handle(async (_req, res) => {
    res.json(await getCapStatus());
  }),
);

operatorCostControlRouter.get(
  '/dashboard',
  handle(async (_req, res) => {
    res.json(await getCostDashboard());
  }),
);

operatorCostControlRouter.get(
  '/alerts',
  handle(async (_req, res) => {
    res.json({ alerts: await listOperatorAlerts() });
  }),
);

operatorCostControlRouter.post(
  '/alerts/read-all',
  handle(async (_req, res) => {
    res.json({ updated: await markAllOperatorAlertsRead() });
  }),
);
