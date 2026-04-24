import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { pinDirectoryToIPFS, pinFileToIPFS } from '../services/ipfsService';
import { logger } from '../utils/logger';
import { getRouteParam } from '../utils/routeParams';

export const deploymentsRouter = Router();

// All deployment routes require authentication
deploymentsRouter.use(piAuthMiddleware);

// Store files in memory (max 50 MB per upload)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

/**
 * POST /api/deployments
 * Upload files and deploy to IPFS.
 */
deploymentsRouter.post(
  '/',
  upload.array('files', 500),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const bodySchema = z.object({ projectId: z.string().min(1) });
    const parsed = bodySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    const { projectId } = parsed.data;
    const rawFiles = req.files;
    const files: Express.Multer.File[] = Array.isArray(rawFiles) ? rawFiles : [];

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    // Verify project belongs to the user
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user!.id },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check storage quota
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const uploadSize = files.reduce((acc, f) => acc + f.size, 0);
    if (user.storageUsed + BigInt(uploadSize) > user.storageLimit) {
      res.status(402).json({ error: 'Storage limit exceeded. Please upgrade to Premium.' });
      return;
    }

    // Create deployment record in PENDING state
    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        cid: '',
        gateway: '',
        size: BigInt(uploadSize),
        status: 'PENDING',
      },
    });

    // Run the IPFS upload asynchronously so we can return immediately
    (async () => {
      try {
        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'UPLOADING' },
        });

        let pinResult;
        if (files.length === 1) {
          pinResult = await pinFileToIPFS(
            files[0].buffer,
            files[0].originalname,
            files[0].mimetype,
          );
        } else {
          const fileMaps = files.map((f) => ({
            buffer: f.buffer,
            path: f.originalname,
            mimeType: f.mimetype,
          }));
          pinResult = await pinDirectoryToIPFS(fileMaps, project.name);
        }

        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'PINNING' },
        });

        // Short delay to simulate pinning confirmation
        await new Promise((r) => setTimeout(r, 1000));

        await prisma.deployment.update({
          where: { id: deployment.id },
          data: {
            cid: pinResult.cid,
            gateway: pinResult.gatewayUrl,
            size: BigInt(pinResult.size),
            status: 'ACTIVE',
          },
        });

        // Update user storage usage
        await prisma.user.update({
          where: { id: req.user!.id },
          data: { storageUsed: { increment: BigInt(pinResult.size) } },
        });

        logger.info('Deployment activated', { deploymentId: deployment.id, cid: pinResult.cid });
      } catch (err) {
        logger.error('Deployment failed', { deploymentId: deployment.id, error: err });
        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'FAILED' },
        });
      }
    })();

    res.status(202).json({ deployment: { id: deployment.id, status: 'PENDING' } });
  },
);

/**
 * GET /api/deployments/:id
 * Get deployment status and details.
 */
deploymentsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const deployment = await prisma.deployment.findFirst({
      where: {
        id: getRouteParam(req.params.id),
        project: { userId: req.user!.id },
      },
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    if (!deployment) {
      res.status(404).json({ error: 'Deployment not found' });
      return;
    }

    res.json({ deployment });
  } catch (err) {
    logger.error('Failed to get deployment', { error: err });
    res.status(500).json({ error: 'Failed to get deployment' });
  }
});

/**
 * GET /api/deployments/project/:projectId
 * List all deployments for a project.
 */
deploymentsRouter.get('/project/:projectId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: getRouteParam(req.params.projectId), userId: req.user!.id },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const deployments = await prisma.deployment.findMany({
      where: { projectId: getRouteParam(req.params.projectId) },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ deployments });
  } catch (err) {
    logger.error('Failed to list deployments', { error: err });
    res.status(500).json({ error: 'Failed to list deployments' });
  }
});
