/**
 * Operator-only GO-LIVE console — the single switch that turns the whole backend
 * lane (provisioning, env wiring, metering, dormancy) from inert to live.
 *
 * Every route is behind piAuthMiddleware + requireOperator (Pi-id allowlist) and
 * is never exposed to end users. GET returns the config plus the full
 * per-capability readiness (so the operator can see exactly what is still
 * missing); PATCH flips the master switch / paid attestation.
 */
import { Router, Response } from 'express';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { requireOperator } from '../middleware/requireOperator';
import { logger } from '../utils/logger';
import {
  getGoLiveConfig,
  updateGoLiveConfig,
  goLiveReadiness,
} from '../services/goLiveService';

export const operatorGoLiveRouter = Router();
operatorGoLiveRouter.use(piAuthMiddleware, requireOperator);

function handle(
  fn: (req: AuthenticatedRequest, res: Response) => Promise<void>,
) {
  return async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.error('Operator go-live route error', {
        path: req.path,
        error: (err as Error).message,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

operatorGoLiveRouter.get(
  '/',
  handle(async (_req, res) => {
    const [config, readiness] = await Promise.all([
      getGoLiveConfig(),
      goLiveReadiness(),
    ]);
    res.json({ config, readiness });
  }),
);

const patchSchema = z
  .object({
    goLiveEnabled: z.boolean().optional(),
    railwayPaidAttestation: z.boolean().optional(),
  })
  .strict();

operatorGoLiveRouter.patch(
  '/',
  handle(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: 'Invalid go-live config', details: parsed.error.flatten() });
      return;
    }
    const config = await updateGoLiveConfig(parsed.data);
    const readiness = await goLiveReadiness();
    logger.warn('GO-LIVE config updated by operator', {
      goLiveEnabled: config.goLiveEnabled,
      railwayPaidAttestation: config.railwayPaidAttestation,
      masterEnabled: readiness.masterEnabled,
    });
    res.json({ config, readiness });
  }),
);
