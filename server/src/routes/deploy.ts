/**
 * Phase 3: Decentralized Storage Deploy Route
 *
 * POST /api/deploy
 *   - Accepts file uploads via multipart/form-data (field name: "files")
 *   - Enforces a per-upload size limit based on the user's SubscriptionTier
 *   - Checks that the upload will not exceed the user's remaining storage quota
 *   - Pins the file(s) to IPFS and saves a Deployment record in the database
 */

import { Router, Response } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { pinUpload, pinDirectory } from '../services/ipfs';
import { logger } from '../utils/logger';
import { FREE_MAX_UPLOAD_BYTES, PREMIUM_MAX_UPLOAD_BYTES } from '../utils/constants';

export const deployRouter = Router();

// All deploy routes require Pi Network authentication
deployRouter.use(piAuthMiddleware);

/**
 * Return the per-upload byte limit for a given subscription tier.
 * FREE  → 50 MB   (prevents large accidental uploads on the free plan)
 * PREMIUM → 1 GB  (generous limit for serious projects)
 */
function maxUploadBytesForTier(tier: string): number {
  return tier === 'PREMIUM' ? PREMIUM_MAX_UPLOAD_BYTES : FREE_MAX_UPLOAD_BYTES;
}

/**
 * Multer instance configured for in-memory storage.
 * The absolute ceiling is the PREMIUM limit; the per-tier business-logic check
 * below will reject oversized uploads for FREE users before any DB work occurs.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PREMIUM_MAX_UPLOAD_BYTES, files: 500 },
});

/**
 * POST /api/deploy
 * Upload files, enforce tier-based size limits, pin to IPFS, and record the deployment.
 */
deployRouter.post(
  '/',
  upload.array('files', 500),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    // Validate body
    const bodySchema = z.object({ projectId: z.string().min(1) });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    const { projectId } = parsed.data;
    const rawFiles = req.files;
    const files: Express.Multer.File[] = Array.isArray(rawFiles) ? rawFiles : [];

    if (files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    try {
    // Verify the project belongs to the authenticated user
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: req.user!.id },
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Fetch the user's current subscription tier and storage stats
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // --- Tier-based per-upload size enforcement ---
    const uploadSize = files.reduce((acc, f) => acc + BigInt(f.size), 0n);
    const tierLimit = BigInt(maxUploadBytesForTier(user.tier));

    if (uploadSize > tierLimit) {
      res.status(413).json({
        error: `Upload size (${uploadSize.toString()} bytes) exceeds the ${user.tier} tier limit of ${tierLimit.toString()} bytes. Please upgrade to upload larger files.`,
        tier: user.tier,
        limitBytes: tierLimit.toString(),
        uploadBytes: uploadSize.toString(),
      });
      return;
    }

    // --- Cumulative storage quota check ---
    if (user.storageUsed + uploadSize > user.storageLimit) {
      res.status(402).json({
        error: 'Storage quota exceeded. Please upgrade to Premium for more storage.',
        storageUsed: user.storageUsed.toString(),
        storageLimit: user.storageLimit.toString(),
      });
      return;
    }

    // Create a PENDING deployment record immediately so the client gets an ID to poll
    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        cid: '',
        gateway: '',
        size: BigInt(uploadSize),
        status: 'PENDING',
      },
    });

    // Run the IPFS upload asynchronously and update the record when done
    (async () => {
      try {
        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'UPLOADING' },
        });

        // Signal that pinning is about to start, then pin the content
        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'PINNING' },
        });

        // Pin single file or multi-file directory to IPFS
        const pinResult =
          files.length === 1
            ? await pinUpload(files[0].buffer, files[0].originalname, files[0].mimetype)
            : await pinDirectory(
                files.map((f) => ({ buffer: f.buffer, path: f.originalname, mimeType: f.mimetype })),
                project.name,
              );

        // Save the IPFS hash, mark deployment ACTIVE, and update storage quota atomically
        await prisma.deployment.update({
          where: { id: deployment.id },
          data: {
            cid: pinResult.ipfsHash,
            gateway: pinResult.gatewayUrl,
            size: BigInt(pinResult.size),
            status: 'ACTIVE',
          },
        });

        // Only increment storage after the deployment record is successfully updated
        await prisma.user.update({
          where: { id: req.user!.id },
          data: { storageUsed: { increment: BigInt(pinResult.size) } },
        });

        logger.info('Deployment activated via /api/deploy', {
          deploymentId: deployment.id,
          ipfsHash: pinResult.ipfsHash,
          tier: user.tier,
          uploadBytes: uploadSize,
        });
      } catch (err) {
        logger.error('Deployment failed via /api/deploy', { deploymentId: deployment.id, error: err });
        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'FAILED' },
        });
      }
    })();

    res.status(202).json({
      deployment: {
        id: deployment.id,
        status: 'PENDING',
        projectId,
        uploadBytes: uploadSize,
        tier: user.tier,
      },
    });
    } catch (err) {
      logger.error('Failed to create deployment record', { error: err });
      res.status(500).json({ error: 'Failed to create deployment' });
    }
  },
);

/**
 * Multer error handler — catches file-size limit errors thrown by multer itself
 * (e.g. when a single file exceeds PREMIUM_MAX_UPLOAD_BYTES) and returns a
 * structured JSON response instead of an unhandled exception.
 */
deployRouter.use((err: unknown, _req: AuthenticatedRequest, res: Response, next: (e: unknown) => void) => {
  if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large. Maximum upload size is 1 GB.' });
    return;
  }
  next(err);
});
