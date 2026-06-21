import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { pinDirectory, pinFile, describePinError } from '../services/ipfs';
import { logger } from '../utils/logger';
import { isPinataConfigured } from '../utils/integrations';
import { getRouteParam } from '../utils/routeParams';
import { maxUploadBytesForTier, TIER2_MAX_UPLOAD_BYTES } from '../utils/constants';
import {
  DeployFile,
  getMimeType,
  extractZipToFiles,
  detectProjectType,
  resolveDeployable,
  scanPiSdk,
  shouldIgnoreFile,
  UploadTooLargeError,
} from '../utils/deployFiles';
import {
  createStage,
  claimStage,
  releaseStage,
  deleteStage,
} from '../services/stagingStore';

export const deploymentsRouter = Router();
deploymentsRouter.use(piAuthMiddleware);

// ─── Multer ──────────────────────────────────────────────────────────────────
// Absolute ceiling = Tier 2 limit (1 GB) — enough for in-memory processing.
// Per-tier business logic enforces lower caps for FREE/TIER1 users.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TIER2_MAX_UPLOAD_BYTES, files: 2000 },
});

// ─── Upload assembly ───────────────────────────────────────────────────────────

interface SingleFile {
  buffer: Buffer;
  name: string;
  mimeType: string;
}

interface AssembledUpload {
  /** Directory upload (ZIP / folder / multi-file) reconstructed with paths. */
  files: DeployFile[] | null;
  /** A lone non-ZIP file (pinned directly). */
  single: SingleFile | null;
}

function detectZip(f: Express.Multer.File): boolean {
  const name = f.originalname.toLowerCase();
  return (
    name.endsWith('.zip') ||
    f.mimetype === 'application/zip' ||
    f.mimetype === 'application/x-zip-compressed' ||
    (f.mimetype === 'application/octet-stream' && name.endsWith('.zip'))
  );
}

export function assembleUpload(
  multerFiles: Express.Multer.File[],
  clientFilePaths: string[] | null,
): AssembledUpload {
  const isZip = multerFiles.length === 1 && detectZip(multerFiles[0]);

  if (isZip) {
    return { files: extractZipToFiles(multerFiles[0].buffer), single: null };
  }

  if (multerFiles.length > 1 || clientFilePaths) {
    // Drop secret/ignored files (.env, keys, node_modules, ...) so a folder
    // upload can never pin them to public IPFS — same guard as ZIP extraction.
    const files: DeployFile[] = multerFiles
      .map((f, i) => {
        const path = clientFilePaths?.[i] ?? f.originalname;
        return { buffer: f.buffer, path, mimeType: getMimeType(path) || f.mimetype };
      })
      .filter((file) => !shouldIgnoreFile(file.path));
    return { files, single: null };
  }

  const only = multerFiles[0];
  // A lone secret/ignored file has nothing deployable — never pin it.
  if (shouldIgnoreFile(only.originalname)) {
    return { files: [], single: null };
  }
  return {
    files: null,
    single: { buffer: only.buffer, name: only.originalname, mimeType: only.mimetype },
  };
}

/** Parse the optional `filePaths` JSON field sent alongside folder uploads. */
function parseFilePaths(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

// ─── Shared pin pipeline ───────────────────────────────────────────────────────

/**
 * Run the async IPFS pin for an already-created Deployment record, advancing its
 * status and persisting the real failure reason if Pinata rejects it. Used by
 * both the legacy one-shot deploy and the staged "deploy to IPFS" step.
 */
async function executePin(opts: {
  deploymentId: string;
  userId: string;
  projectName: string;
  pinFiles: DeployFile[] | null;
  singleFile: SingleFile | null;
  /** When provided, the stage is removed once the pin succeeds. */
  stageId?: string;
}): Promise<void> {
  const { deploymentId, userId, projectName, pinFiles, singleFile, stageId } = opts;

  try {
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'UPLOADING' },
    });

    let pinResult;
    if (pinFiles && pinFiles.length > 0) {
      pinResult = await pinDirectory(pinFiles, projectName);
    } else if (singleFile) {
      pinResult = await pinFile(singleFile.buffer, singleFile.name, singleFile.mimeType);
    } else {
      throw new Error('No files to pin.');
    }

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'PINNING' },
    });
    await new Promise((r) => setTimeout(r, 800));

    await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        cid: pinResult.cid,
        gateway: pinResult.gatewayUrl,
        size: BigInt(pinResult.size),
        status: 'ACTIVE',
        failureReason: null,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { storageUsed: { increment: BigInt(pinResult.size) } },
    });

    if (stageId) deleteStage(stageId);
    logger.info('Deployment activated', { deploymentId, cid: pinResult.cid });
  } catch (err) {
    const failureReason = describePinError(err);
    logger.error('Deployment failed', { deploymentId, error: failureReason });
    // Release the pin claim so the user can retry the same staged upload.
    if (stageId) releaseStage(stageId);
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'FAILED', failureReason },
    });
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/deployments — legacy one-shot deploy (upload + pin immediately).
 *
 * Accepts:
 *   - `files`     — multipart file field(s)
 *   - `projectId` — form field (required)
 *   - `filePaths` — JSON-encoded string[] of relative paths aligned to `files`
 *
 * A single `.zip` file is automatically extracted and deployed as a directory.
 * The staged flow (POST /stage → POST /:stageId/pin) is preferred for the main
 * deploy page; this remains for the dashboard quick-deploy.
 */
deploymentsRouter.post(
  '/',
  upload.array('files', 2000),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = z.object({ projectId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    const { projectId } = parsed.data;

    const multerFiles: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];
    if (multerFiles.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    if (!isPinataConfigured()) {
      res.status(503).json({
        error: 'IPFS deployments are currently unavailable (Pinata is not configured).',
        integration: 'pinata',
      });
      return;
    }

    const clientFilePaths = parseFilePaths(req.body.filePaths);

    try {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: req.user!.id },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const rawUploadSize = multerFiles.reduce((acc, f) => acc + BigInt(f.size), 0n);
      if (rawUploadSize > BigInt(maxUploadBytesForTier(user.tier))) {
        res.status(413).json({
          error: `Upload size (${(Number(rawUploadSize) / 1024 / 1024).toFixed(1)} MB) exceeds your plan's per-upload limit. Upgrade to upload larger projects.`,
          kind: 'upload_too_large',
        });
        return;
      }
      if (user.storageUsed + rawUploadSize > user.storageLimit) {
        res.status(402).json({
          error: 'Storage quota exceeded. Upgrade to get more IPFS storage.',
          kind: 'storage_limit',
        });
        return;
      }

      const { files: pinFiles, single } = assembleUpload(multerFiles, clientFilePaths);
      if (pinFiles && pinFiles.length === 0) {
        res.status(400).json({
          error: 'The upload is empty or contains only ignored files (e.g. .env, keys, node_modules).',
        });
        return;
      }
      if (pinFiles) {
        const { type, entryPoint } = detectProjectType(pinFiles.map((f) => f.path));
        logger.info('Project type detected', { projectId, type, entryPoint, fileCount: pinFiles.length });
      }

      const deployment = await prisma.deployment.create({
        data: { projectId, cid: '', gateway: '', size: rawUploadSize, status: 'PENDING' },
      });

      void executePin({
        deploymentId: deployment.id,
        userId: req.user!.id,
        projectName: project.name,
        pinFiles,
        singleFile: single,
      });

      res.status(202).json({ deployment: { id: deployment.id, status: 'PENDING' } });
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        res.status(413).json({ error: err.message, kind: 'upload_too_large' });
        return;
      }
      logger.error('Failed to create deployment record', { error: err });
      res.status(500).json({ error: 'Failed to create deployment' });
    }
  },
);

/**
 * POST /api/deployments/stage — upload + validate WITHOUT pinning.
 *
 * Reconstructs the upload, decides whether it is a deployable static site and
 * where its root is, scans for the Pi SDK, and stashes the deployable subset in
 * the staging store so the client can preview it in a sandboxed iframe before
 * committing. Returns a halt reason (not an error) when the project needs to be
 * built first or has no index.html — we never fake a build server-side.
 */
deploymentsRouter.post(
  '/stage',
  upload.array('files', 2000),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = z.object({ projectId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    const { projectId } = parsed.data;

    const multerFiles: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];
    if (multerFiles.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const clientFilePaths = parseFilePaths(req.body.filePaths);

    try {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: req.user!.id },
      });
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const rawUploadSize = multerFiles.reduce((acc, f) => acc + BigInt(f.size), 0n);
      if (rawUploadSize > BigInt(maxUploadBytesForTier(user.tier))) {
        res.status(413).json({
          error: `Upload size (${(Number(rawUploadSize) / 1024 / 1024).toFixed(1)} MB) exceeds your plan's per-upload limit. Upgrade to upload larger projects.`,
          kind: 'upload_too_large',
        });
        return;
      }

      const { files, single } = assembleUpload(multerFiles, clientFilePaths);
      const allFiles: DeployFile[] =
        files ??
        (single
          ? [{ buffer: single.buffer, path: single.name, mimeType: single.mimeType }]
          : []);

      if (allFiles.length === 0) {
        res.status(400).json({ error: 'No deployable files found in the upload.' });
        return;
      }

      const resolution = resolveDeployable(allFiles);

      if (!resolution.deployable) {
        res.status(200).json({
          deployable: false,
          haltReason: resolution.haltReason,
          projectType: resolution.projectType,
          fileCount: allFiles.length,
          totalBytes: Number(rawUploadSize),
          fileTree: allFiles
            .slice(0, 50)
            .map((f) => ({ path: f.path, size: f.buffer.length })),
        });
        return;
      }

      const deployBytes = resolution.files.reduce((acc, f) => acc + f.buffer.length, 0);
      if (user.storageUsed + BigInt(deployBytes) > user.storageLimit) {
        res.status(402).json({
          error: 'Storage quota exceeded. Upgrade to get more IPFS storage.',
          kind: 'storage_limit',
        });
        return;
      }

      const sdk = scanPiSdk(resolution.files);
      const stage = createStage({
        userId: req.user!.id,
        projectId,
        projectName: project.name,
        rootPrefix: resolution.rootPrefix,
        entryPoint: resolution.entryPoint as string,
        files: resolution.files,
        totalBytes: deployBytes,
      });

      logger.info('Upload staged', {
        stageId: stage.id,
        projectId,
        projectType: resolution.projectType,
        rootPrefix: resolution.rootPrefix,
        entryPoint: resolution.entryPoint,
        fileCount: resolution.files.length,
      });

      res.status(200).json({
        deployable: true,
        stageId: stage.id,
        projectType: resolution.projectType,
        rootPrefix: resolution.rootPrefix,
        entryPoint: resolution.entryPoint,
        fileCount: resolution.files.length,
        totalBytes: deployBytes,
        fileTree: resolution.files
          .slice(0, 50)
          .map((f) => ({ path: f.path, size: f.buffer.length })),
        sdk,
        previewPath: `/preview/${stage.id}/`,
      });
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        res.status(413).json({ error: err.message, kind: 'upload_too_large' });
        return;
      }
      logger.error('Failed to stage upload', { error: err });
      res.status(500).json({ error: 'Failed to stage upload' });
    }
  },
);

/**
 * POST /api/deployments/:stageId/pin — pin a previously staged upload to IPFS.
 */
deploymentsRouter.post(
  '/:stageId/pin',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const stageId = getRouteParam(req.params.stageId);

    // Atomically claim the stage so concurrent/double-clicked pins can't create
    // multiple deployments from the same upload (double-pin + quota bypass).
    const claim = claimStage(stageId, req.user!.id);
    if (!claim.ok) {
      if (claim.reason === 'pinning') {
        res.status(409).json({ error: 'This upload is already being deployed.' });
      } else {
        res.status(404).json({ error: 'Staged upload not found or expired. Please upload again.' });
      }
      return;
    }
    const stage = claim.stage;

    if (!isPinataConfigured()) {
      releaseStage(stage.id);
      res.status(503).json({
        error: 'IPFS deployments are currently unavailable (Pinata is not configured).',
        integration: 'pinata',
      });
      return;
    }

    try {
      const project = await prisma.project.findFirst({
        where: { id: stage.projectId, userId: req.user!.id },
      });
      if (!project) {
        releaseStage(stage.id);
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) {
        releaseStage(stage.id);
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const size = BigInt(stage.totalBytes);
      if (user.storageUsed + size > user.storageLimit) {
        releaseStage(stage.id);
        res.status(402).json({
          error: 'Storage quota exceeded. Upgrade to get more IPFS storage.',
          kind: 'storage_limit',
        });
        return;
      }

      const deployment = await prisma.deployment.create({
        data: { projectId: stage.projectId, cid: '', gateway: '', size, status: 'PENDING' },
      });

      // executePin owns the stage lifecycle from here: delete on success,
      // release on failure (so a retry can re-claim and re-pin).
      void executePin({
        deploymentId: deployment.id,
        userId: req.user!.id,
        projectName: stage.projectName,
        pinFiles: stage.files,
        singleFile: null,
        stageId: stage.id,
      });

      res.status(202).json({ deployment: { id: deployment.id, status: 'PENDING' } });
    } catch (err) {
      releaseStage(stage.id);
      logger.error('Failed to pin staged upload', { error: err });
      res.status(500).json({ error: 'Failed to start deployment' });
    }
  },
);

/**
 * GET /api/deployments/:id — get deployment status (includes failureReason).
 */
deploymentsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const deployment = await prisma.deployment.findFirst({
      where: { id: getRouteParam(req.params.id), project: { userId: req.user!.id } },
      include: { project: { select: { id: true, name: true } } },
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
 * GET /api/deployments/project/:projectId — list project deployments.
 */
deploymentsRouter.get(
  '/project/:projectId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
  },
);
