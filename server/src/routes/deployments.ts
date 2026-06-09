import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import AdmZip from 'adm-zip';
import nodePath from 'path';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { pinDirectory, pinFile } from '../services/ipfs';
import { logger } from '../utils/logger';
import { isPinataConfigured } from '../utils/integrations';
import { getRouteParam } from '../utils/routeParams';
import {
  maxUploadBytesForTier,
  TIER2_MAX_UPLOAD_BYTES,
} from '../utils/constants';

export const deploymentsRouter = Router();
deploymentsRouter.use(piAuthMiddleware);

// ─── Multer ──────────────────────────────────────────────────────────────────
// Absolute ceiling = Tier 2 limit (1 GB) — enough for in-memory processing.
// Per-tier business logic enforces lower caps for FREE/TIER1 users.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TIER2_MAX_UPLOAD_BYTES, files: 2000 },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  '.env',
]);

function shouldIgnoreFile(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.some((p) => IGNORED_SEGMENTS.has(p));
}

function getMimeType(filePath: string): string {
  const ext = nodePath.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.cjs': 'application/javascript',
    '.ts': 'application/typescript',
    '.jsx': 'application/javascript',
    '.tsx': 'application/typescript',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.xml': 'application/xml',
    '.map': 'application/json',
    '.pdf': 'application/pdf',
  };
  return types[ext] ?? 'application/octet-stream';
}

/**
 * Extract a ZIP buffer into a flat file list with cleaned relative paths.
 * Strips a common root folder if all entries share one (typical of zipped
 * project directories exported from Replit, GitHub, etc.).
 */
function extractZipToFiles(
  buffer: Buffer,
): Array<{ buffer: Buffer; path: string; mimeType: string }> {
  const zip = new AdmZip(buffer);
  const raw: Array<{ buffer: Buffer; path: string; mimeType: string }> = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const entryPath = entry.entryName.replace(/\\/g, '/');
    if (shouldIgnoreFile(entryPath)) continue;
    raw.push({
      buffer: entry.getData(),
      path: entryPath,
      mimeType: getMimeType(entryPath),
    });
  }

  if (raw.length === 0) return raw;

  // Strip shared root folder (e.g. "myproject/" prefix common in GitHub ZIPs).
  const roots = new Set(raw.map((f) => f.path.split('/')[0]));
  if (roots.size === 1) {
    const prefix = Array.from(roots)[0] + '/';
    const stripped = raw
      .map((f) => ({
        ...f,
        path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
      }))
      .filter((f) => f.path.length > 0);
    if (stripped.length > 0) return stripped;
  }

  return raw;
}

/**
 * Detect the project framework type from the list of file paths.
 * Used for logging and future entry-point resolution.
 */
function detectProjectType(filePaths: string[]): { type: string; entryPoint: string | null } {
  const has = (name: string) =>
    filePaths.some((p) => p === name || p.endsWith('/' + name));

  let type = 'static';
  if (has('package.json')) {
    if (has('vite.config.ts') || has('vite.config.js')) type = 'vite';
    else if (has('next.config.js') || has('next.config.ts')) type = 'nextjs';
    else if (has('angular.json')) type = 'angular';
    else type = 'node';
  } else if (has('requirements.txt') || has('pyproject.toml')) {
    type = 'python-static';
  }

  const entryPriority = [
    'index.html',
    'dist/index.html',
    'build/index.html',
    'public/index.html',
    'out/index.html',
    '_site/index.html',
  ];
  const entryPoint = entryPriority.find((p) => filePaths.includes(p)) ?? null;

  return { type, entryPoint };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /api/deployments
 *
 * Accepts:
 *   - `files`     — multipart file field(s)
 *   - `projectId` — form field (required)
 *   - `filePaths` — JSON-encoded string[] of relative paths in the same order
 *                   as `files` (used for folder uploads to preserve structure)
 *
 * A single `.zip` file is automatically extracted and deployed as a directory.
 */
deploymentsRouter.post(
  '/',
  upload.array('files', 2000),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const bodySchema = z.object({ projectId: z.string().min(1) });
    const parsed = bodySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }

    const { projectId } = parsed.data;
    const rawFiles = req.files;
    const multerFiles: Express.Multer.File[] = Array.isArray(rawFiles) ? rawFiles : [];

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

    // Parse optional filePaths JSON (sent alongside folder uploads).
    let clientFilePaths: string[] | null = null;
    if (req.body.filePaths) {
      try {
        clientFilePaths = JSON.parse(req.body.filePaths as string) as string[];
      } catch {
        // Malformed JSON — fall back to originalname.
      }
    }

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

      // Per-tier upload size enforcement.
      const rawUploadSize = multerFiles.reduce((acc, f) => acc + BigInt(f.size), 0n);
      const tierUploadLimit = BigInt(maxUploadBytesForTier(user.tier));
      if (rawUploadSize > tierUploadLimit) {
        res.status(413).json({
          error: `Upload size (${(Number(rawUploadSize) / 1024 / 1024).toFixed(1)} MB) exceeds your plan's per-upload limit. Upgrade to upload larger projects.`,
          kind: 'upload_too_large',
        });
        return;
      }

      // Storage quota check.
      if (user.storageUsed + rawUploadSize > user.storageLimit) {
        res.status(402).json({
          error: 'Storage quota exceeded. Upgrade to get more IPFS storage.',
          kind: 'storage_limit',
        });
        return;
      }

      // ── Determine pin strategy ──
      const isZip =
        multerFiles.length === 1 &&
        (multerFiles[0].originalname.toLowerCase().endsWith('.zip') ||
          multerFiles[0].mimetype === 'application/zip' ||
          multerFiles[0].mimetype === 'application/x-zip-compressed' ||
          multerFiles[0].mimetype === 'application/octet-stream' && multerFiles[0].originalname.toLowerCase().endsWith('.zip'));

      // Build a pinnable file list.
      type PinFile = { buffer: Buffer; path: string; mimeType: string };
      let pinFiles: PinFile[] | null = null;

      if (isZip) {
        pinFiles = extractZipToFiles(multerFiles[0].buffer);
        if (pinFiles.length === 0) {
          res.status(400).json({ error: 'The ZIP appears to be empty or contains only ignored files.' });
          return;
        }
      } else if (multerFiles.length > 1 || clientFilePaths) {
        // Multi-file or folder upload — use provided relative paths.
        pinFiles = multerFiles.map((f, i) => ({
          buffer: f.buffer,
          path: clientFilePaths?.[i] ?? f.originalname,
          mimeType: getMimeType(clientFilePaths?.[i] ?? f.originalname) || f.mimetype,
        }));
      }
      // else: single non-ZIP file → use pinFile() directly.

      if (pinFiles) {
        const { type, entryPoint } = detectProjectType(pinFiles.map((f) => f.path));
        logger.info('Project type detected', { projectId, type, entryPoint, fileCount: pinFiles.length });
      }

      const deployment = await prisma.deployment.create({
        data: {
          projectId,
          cid: '',
          gateway: '',
          size: rawUploadSize,
          status: 'PENDING',
        },
      });

      // Async IPFS pipeline — returns 202 immediately.
      (async () => {
        try {
          await prisma.deployment.update({ where: { id: deployment.id }, data: { status: 'UPLOADING' } });

          let pinResult;
          if (pinFiles) {
            pinResult = await pinDirectory(pinFiles, project.name);
          } else {
            pinResult = await pinFile(
              multerFiles[0].buffer,
              multerFiles[0].originalname,
              multerFiles[0].mimetype,
            );
          }

          await prisma.deployment.update({ where: { id: deployment.id }, data: { status: 'PINNING' } });
          await new Promise((r) => setTimeout(r, 800));

          await prisma.deployment.update({
            where: { id: deployment.id },
            data: {
              cid: pinResult.cid,
              gateway: pinResult.gatewayUrl,
              size: BigInt(pinResult.size),
              status: 'ACTIVE',
            },
          });

          await prisma.user.update({
            where: { id: req.user!.id },
            data: { storageUsed: { increment: BigInt(pinResult.size) } },
          });

          logger.info('Deployment activated', { deploymentId: deployment.id, cid: pinResult.cid });
        } catch (err) {
          logger.error('Deployment failed', { deploymentId: deployment.id, error: err });
          await prisma.deployment.update({ where: { id: deployment.id }, data: { status: 'FAILED' } });
        }
      })();

      res.status(202).json({ deployment: { id: deployment.id, status: 'PENDING' } });
    } catch (err) {
      logger.error('Failed to create deployment record', { error: err });
      res.status(500).json({ error: 'Failed to create deployment' });
    }
  },
);

/**
 * GET /api/deployments/:id — get deployment status.
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
