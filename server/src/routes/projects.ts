import { Router, Response } from 'express';
import { Readable } from 'stream';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import { getRouteParam } from '../utils/routeParams';
import { TIER_DOMAIN_LIMITS } from '../utils/constants';
import { IntegrationUnavailableError } from '../utils/integrations';
import {
  getSiteExportInfo,
  fetchSiteArchive,
  getDbExport,
  ExportError,
} from '../services/exportService';
import { deleteProjectFully, DeletionError } from '../services/deletionService';
import { withLiveUrl } from '../utils/gateway';

export const projectsRouter = Router();
projectsRouter.use(piAuthMiddleware);

const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  customDomain: z.string().max(255).optional(),
});

/**
 * GET /api/projects — list all projects for the authenticated user.
 */
projectsRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const projects = await prisma.project.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            cid: true,
            gateway: true,
            entryPath: true,
            liveCheckStatus: true,
            status: true,
            createdAt: true,
            size: true,
          },
        },
        _count: { select: { deployments: true } },
      },
    });
    // Live URLs are derived at read time (dedicated gateway when configured),
    // so legacy rows get the working link too.
    res.json({
      projects: projects.map((p) => ({ ...p, deployments: p.deployments.map(withLiveUrl) })),
    });
  } catch (err) {
    logger.error('Failed to list projects', { error: err });
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

/**
 * POST /api/projects — create a new project.
 */
projectsRouter.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }
  try {
    const project = await prisma.project.create({
      data: { ...parsed.data, userId: req.user!.id },
    });
    res.status(201).json({ project });
  } catch (err) {
    logger.error('Failed to create project', { error: err });
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * GET /api/projects/:id — get a single project with all deployments.
 */
projectsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: getRouteParam(req.params.id), userId: req.user!.id },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            cid: true,
            gateway: true,
            entryPath: true,
            liveCheckStatus: true,
            liveCheckDetail: true,
            liveCheckAt: true,
            status: true,
            size: true,
            createdAt: true,
          },
        },
        // Operator-safe backup status only — NEVER expose Railway ids/domains.
        backendService: {
          select: {
            status: true,
            lastBackupAt: true,
            lastBackupStatus: true,
            lastBackupFailureReason: true,
          },
        },
      },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    // Live URLs derived at read time — see gateway.ts.
    res.json({ project: { ...project, deployments: project.deployments.map(withLiveUrl) } });
  } catch (err) {
    logger.error('Failed to get project', { error: err });
    res.status(500).json({ error: 'Failed to get project' });
  }
});

/**
 * PATCH /api/projects/:id — update a project.
 *
 * When `customDomain` is being set (non-empty), enforces the per-tier domain
 * mapping limit before persisting.
 */
projectsRouter.patch('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = createProjectSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  try {
    const existing = await prisma.project.findFirst({
      where: { id: getRouteParam(req.params.id), userId: req.user!.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Domain-mapping limit check: only when setting a non-empty domain.
    if (parsed.data.customDomain && parsed.data.customDomain.trim() !== '') {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { tier: true },
      });
      const domainLimit = TIER_DOMAIN_LIMITS[user?.tier ?? 'FREE'] ?? 1;

      if (domainLimit !== -1) {
        const alreadyMapped = await prisma.project.count({
          where: {
            userId: req.user!.id,
            customDomain: { not: null },
            id: { not: getRouteParam(req.params.id) },
          },
        });
        if (alreadyMapped >= domainLimit) {
          res.status(403).json({
            error: `Your plan allows mapping ${domainLimit} domain${domainLimit !== 1 ? 's' : ''}. Upgrade to map more domains.`,
            kind: 'domain_limit',
          });
          return;
        }
      }
    }

    const project = await prisma.project.update({
      where: { id: getRouteParam(req.params.id) },
      data: parsed.data,
    });
    res.json({ project });
  } catch (err) {
    logger.error('Failed to update project', { error: err });
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * GET /api/projects/:id/export/site — data portability for the site.
 *
 * Always returns the CID + public gateway links (the inherent no-lock-in
 * guarantee). When `?archive=1` it additionally streams a best-effort CAR archive
 * of the content from a public IPFS gateway; if the gateway can't produce one we
 * fall back to an honest JSON payload with the CID/links — never a fake file.
 */
projectsRouter.get(
  '/:id/export/site',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const projectId = getRouteParam(req.params.id);
    try {
      const info = await getSiteExportInfo(projectId, req.user!.id);

      // Default (no archive): hand back the CID + links — this alone is the export.
      if (req.query.archive !== '1' && req.query.archive !== 'true') {
        res.json({ cid: info.cid, gatewayUrls: info.gatewayUrls });
        return;
      }

      const archive = await fetchSiteArchive(info.cid);
      if (!archive.ok) {
        // Honest fallback: no archive, but the user still has the CID + links.
        res.status(200).json({
          cid: info.cid,
          gatewayUrls: info.gatewayUrls,
          archive: null,
          archiveUnavailableReason: archive.reason,
        });
        return;
      }

      res.setHeader('Content-Type', archive.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${archive.filename}"`,
      );
      Readable.fromWeb(archive.body).pipe(res);
    } catch (err) {
      if (err instanceof ExportError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      logger.error('Site export failed', { projectId, error: (err as Error).message });
      res.status(500).json({ error: 'Failed to export site' });
    }
  },
);

/**
 * GET /api/projects/:id/export/database — stream a pg_dump of the project's live
 * database DIRECTLY to the authenticated owner. Customer DB dumps NEVER touch
 * IPFS. Honest 503 when there is no live database to dump. URI is never logged.
 */
projectsRouter.get(
  '/:id/export/database',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const projectId = getRouteParam(req.params.id);
    try {
      const dump = await getDbExport(projectId, req.user!.id);
      res.setHeader('Content-Type', dump.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${dump.filename}"`);
      res.send(dump.buffer);
    } catch (err) {
      if (err instanceof ExportError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      if (err instanceof IntegrationUnavailableError) {
        res.status(503).json({ error: err.message, integration: err.integration });
        return;
      }
      // Log the real error for diagnostics; never surface connection strings to
      // the client (the generic message is intentional).
      logger.error('Database export failed', { projectId, error: (err as Error).message ?? err });
      res.status(500).json({ error: 'Failed to export database' });
    }
  },
);

/**
 * DELETE /api/projects/:id — fully tear down and delete a project.
 *
 * Delegates to the deletion service, which unpins IPFS, tears down the backend
 * (gated), purges private backups/snapshots, and only then removes the rows. When
 * real resources can't be confirmed gone it returns 202 + DELETING with an honest
 * reason for retry — we NEVER report a fake removal.
 */
projectsRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const projectId = getRouteParam(req.params.id);
  try {
    const result = await deleteProjectFully(projectId, req.user!.id);
    if (result.status === 'DELETED') {
      res.status(204).send();
      return;
    }
    // Teardown incomplete: the app is being deleted but real resources remain.
    res.status(202).json({
      status: 'DELETING',
      message:
        'Your app is being deleted. Some resources are still being torn down and ' +
        'will be retried automatically.',
      reason: result.reason,
    });
  } catch (err) {
    if (err instanceof DeletionError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error('Failed to delete project', { projectId, error: (err as Error).message });
    res.status(500).json({ error: 'Failed to delete project' });
  }
});
