/**
 * Watchdog routes — uptime/health monitoring for hosted sites.
 *
 * GET  /api/watchdog/summary          — per-site up/down/uptime% for authed user
 * GET  /api/watchdog/:deploymentId    — incident timeline + recent checks
 * POST /api/watchdog/:deploymentId/check — manual re-check
 *
 * All routes require piAuthMiddleware; the Watchdog service degrades gracefully
 * when the database is absent, returning { monitoringDisabled: true }.
 */
import { Router, Response } from 'express';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import {
  getWatchdogSummary,
  getDeploymentIncidents,
  manualRecheck,
} from '../services/watchdogService';
import { logger } from '../utils/logger';

export const watchdogRouter = Router();

watchdogRouter.use(piAuthMiddleware);

// GET /api/watchdog/summary
watchdogRouter.get('/summary', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const data = await getWatchdogSummary(userId);
    res.json(data);
  } catch (err) {
    logger.error('Watchdog summary route error', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Failed to load watchdog summary' });
  }
});

// GET /api/watchdog/:deploymentId
watchdogRouter.get('/:deploymentId', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const deploymentId = String(req.params['deploymentId'] ?? '');
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const data = await getDeploymentIncidents(deploymentId, userId);
    if (data && typeof data === 'object' && 'error' in data && (data as { error: string }).error === 'not_found') {
      res.status(404).json({ error: 'Deployment not found or not owned by you' });
      return;
    }
    res.json(data);
  } catch (err) {
    logger.error('Watchdog incidents route error', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Failed to load incident data' });
  }
});

// POST /api/watchdog/:deploymentId/check
watchdogRouter.post('/:deploymentId/check', async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const deploymentId = String(req.params['deploymentId'] ?? '');
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  try {
    const result = await manualRecheck(deploymentId, userId);
    if (result && typeof result === 'object') {
      if ('error' in result) {
        const err = (result as { error: string }).error;
        if (err === 'not_found') { res.status(404).json({ error: 'Deployment not found or not owned by you' }); return; }
        if (err === 'no_url') { res.status(422).json({ error: 'Deployment has no URL to check' }); return; }
        if (err === 'check_failed') { res.status(502).json({ error: 'Check failed — site unreachable' }); return; }
      }
    }
    res.json(result);
  } catch (err) {
    logger.error('Watchdog manual check route error', { error: err, requestId: req.requestId });
    res.status(500).json({ error: 'Failed to perform check' });
  }
});
