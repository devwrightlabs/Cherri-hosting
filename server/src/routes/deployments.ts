import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { piAuthMiddleware, AuthenticatedRequest } from '../middleware/piAuth';
import { prisma } from '../utils/prismaClient';
import { pinDirectory, pinFile, describePinError } from '../services/ipfs';
import { logger } from '../utils/logger';
import { isPinataConfigured } from '../utils/integrations';
import { isRailwayConfigured } from '../services/railway';
import { getRouteParam } from '../utils/routeParams';
import { maxUploadBytesForTier, TIER2_MAX_UPLOAD_BYTES } from '../utils/constants';
import {
  DeployFile,
  getMimeType,
  extractZipToFiles,
  detectProjectType,
  detectBackendNeed,
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
import {
  enqueueBuild,
  getBuildJob,
  getBuildLogs,
  hasActiveBuild,
  detectPackageManager,
  readBuildScript,
  type BuildFinalizer,
} from '../services/buildService';

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

// ─── Shared build-or-stage responder ───────────────────────────────────────────

interface QuotaUser {
  tier: string;
  storageUsed: bigint;
  storageLimit: bigint;
}

/**
 * Given an assembled set of upload files, either stage a deployable static site
 * immediately, queue a REAL server-side build, or halt honestly. Shared by the
 * file-upload (/build-stage) and GitHub-import (/import-github) ingestion paths
 * so both reuse the identical staged-deploy + build invariants.
 */
async function respondBuildOrStage(
  res: Response,
  ctx: {
    userId: string;
    projectId: string;
    projectName: string;
    user: QuotaUser;
    allFiles: DeployFile[];
    rawUploadBytes: number;
  },
): Promise<void> {
  const { userId, projectId, projectName, user, allFiles, rawUploadBytes } = ctx;

  if (allFiles.length === 0) {
    res.status(400).json({ error: 'No deployable files found.' });
    return;
  }

  // Does this project need a server-side backend? PAID tiers can deploy one
  // (a service + database); the front-end still pins to IPFS regardless. The
  // offer is surfaced here; provisioning is enforced server-side on the
  // /backend-deploy route. Free = front-end only.
  const backend = detectBackendNeed(allFiles);
  const backendEligible = user.tier !== 'FREE';
  if (backend.needsBackend) {
    logger.info('Backend need detected', { projectId, backendEligible, reasons: backend.reasons });
  }

  const resolution = resolveDeployable(allFiles);

  // Already a deployable static / pre-built site → stage now, no build.
  if (resolution.deployable) {
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
      userId,
      projectId,
      projectName,
      rootPrefix: resolution.rootPrefix,
      entryPoint: resolution.entryPoint as string,
      files: resolution.files,
      totalBytes: deployBytes,
    });
    res.status(200).json({
      needsBuild: false,
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
      needsBackend: backend.needsBackend,
      backendEligible,
      previewPath: `/preview/${stage.id}/`,
    });
    return;
  }

  // Not statically deployable. Build it only if there is a build script.
  const buildScript = readBuildScript(allFiles);
  if (!buildScript) {
    res.status(200).json({
      needsBuild: false,
      deployable: false,
      haltReason: resolution.haltReason,
      projectType: resolution.projectType,
      needsBackend: backend.needsBackend,
      backendEligible,
      fileCount: allFiles.length,
      totalBytes: rawUploadBytes,
      fileTree: allFiles
        .slice(0, 50)
        .map((f) => ({ path: f.path, size: f.buffer.length })),
    });
    return;
  }

  if (hasActiveBuild(userId)) {
    res.status(429).json({
      error: 'You already have a build running. Wait for it to finish before starting another.',
    });
    return;
  }

  const packageManager = detectPackageManager(allFiles);

  // Finalizer runs after a successful build: re-check storage quota against the
  // BUILT output and create the stage (same invariants as /stage).
  const finalize: BuildFinalizer = async (output) => {
    const resolved = resolveDeployable(output.files);
    if (!resolved.deployable) {
      return {
        ok: false,
        error: resolved.haltReason ?? 'The build output is not a deployable site.',
      };
    }
    const deployBytes = resolved.files.reduce((acc, f) => acc + f.buffer.length, 0);
    const freshUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!freshUser) return { ok: false, error: 'User not found.' };
    if (freshUser.storageUsed + BigInt(deployBytes) > freshUser.storageLimit) {
      return {
        ok: false,
        error: 'Storage quota exceeded. Upgrade to get more IPFS storage.',
      };
    }
    const sdk = scanPiSdk(resolved.files);
    const stage = createStage({
      userId,
      projectId,
      projectName,
      rootPrefix: resolved.rootPrefix,
      entryPoint: resolved.entryPoint as string,
      files: resolved.files,
      totalBytes: deployBytes,
    });
    return {
      ok: true,
      stage: {
        stageId: stage.id,
        previewPath: `/preview/${stage.id}/`,
        entryPoint: resolved.entryPoint as string,
        projectType: resolved.projectType,
        fileCount: resolved.files.length,
        totalBytes: deployBytes,
        sdk,
      },
    };
  };

  const job = enqueueBuild({
    userId,
    projectId,
    projectName,
    files: allFiles,
    packageManager,
    finalize,
  });

  logger.info('Build queued', { jobId: job.id, projectId, packageManager });
  res.status(202).json({
    needsBuild: true,
    jobId: job.id,
    packageManager,
    needsBackend: backend.needsBackend,
    backendEligible,
  });
}

// ─── GitHub public-repo import (Feature B) ─────────────────────────────────────

interface GitHubRepoRef {
  owner: string;
  repo: string;
  /** Branch / tag / commit pulled from a /tree/<ref> URL, if any. */
  ref?: string;
}

/** Parse an owner/repo (+ optional ref) from common GitHub URL shapes. */
function parseGitHubRepo(input: string): GitHubRepoRef | null {
  const s = input.trim().replace(/\.git$/i, '');
  const urlMatch = s.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/([^\s?#]+))?/i,
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      ref: urlMatch[3] ? decodeURIComponent(urlMatch[3]) : undefined,
    };
  }
  const shorthand = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };
  return null;
}

type GitHubMetaResult =
  | { ok: true; defaultBranch: string }
  | { ok: false; status: number; error: string };

/** Resolve repo metadata via the public GitHub API (also detects private/404). */
async function fetchGitHubMeta(owner: string, repo: string): Promise<GitHubMetaResult> {
  let resp: globalThis.Response;
  try {
    resp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      {
        headers: { 'User-Agent': 'Cherri-Hosting', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    return { ok: false, status: 502, error: 'Could not reach GitHub. Check the URL and try again.' };
  }
  if (resp.status === 404) {
    return {
      ok: false,
      status: 404,
      error:
        "Repository not found. If it's private, Cherri can't import it yet — private repos need an access token, which we don't fake.",
    };
  }
  if (resp.status === 403) {
    return {
      ok: false,
      status: 429,
      error: 'GitHub rate limit reached for this server. Please try again in a little while.',
    };
  }
  if (!resp.ok) {
    return { ok: false, status: 502, error: `GitHub returned an error (${resp.status}).` };
  }
  const json = (await resp.json()) as { default_branch?: string; private?: boolean };
  if (json.private) {
    return {
      ok: false,
      status: 400,
      error: 'That repository is private. Cherri can only import public repositories right now.',
    };
  }
  return { ok: true, defaultBranch: json.default_branch || 'main' };
}

type ZipDownloadResult =
  | { ok: true; buffer: Buffer }
  | { ok: false; status: number; error: string; kind?: string };

/**
 * Read a response body into a Buffer, streaming chunk-by-chunk and aborting the
 * moment the running total exceeds `maxBytes`. This enforces the tier cap BEFORE
 * allocating the whole body, so a missing/incorrect content-length can't be used
 * to force the server to buffer an unbounded archive into memory.
 */
async function readCappedBody(
  resp: globalThis.Response,
  maxBytes: number,
): Promise<Buffer | 'too_large'> {
  const reader = resp.body?.getReader();
  if (!reader) {
    // No readable stream — fall back to a buffered read with a post-guard.
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.length > maxBytes ? 'too_large' : buf;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return 'too_large';
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

/** Download a repo archive (zip) from codeload, capped to the tier byte limit. */
async function downloadRepoZip(
  owner: string,
  repo: string,
  ref: string,
  refExplicit: boolean,
  maxBytes: number,
): Promise<ZipDownloadResult> {
  const base = `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip`;
  const e = encodeURIComponent(ref);
  // For an explicit ref, try branch → tag → raw commit; otherwise the default branch.
  const candidates = refExplicit
    ? [`${base}/refs/heads/${e}`, `${base}/refs/tags/${e}`, `${base}/${e}`]
    : [`${base}/refs/heads/${e}`];

  for (const url of candidates) {
    let resp: globalThis.Response;
    try {
      resp = await fetch(url, {
        headers: { 'User-Agent': 'Cherri-Hosting' },
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      continue;
    }
    if (resp.status === 404) continue;
    if (!resp.ok) {
      return {
        ok: false,
        status: 502,
        error: `GitHub returned an error downloading the archive (${resp.status}).`,
      };
    }
    const declared = Number(resp.headers.get('content-length') || '0');
    if (declared && declared > maxBytes) {
      return {
        ok: false,
        status: 413,
        error: `That repository's archive (${(declared / 1024 / 1024).toFixed(1)} MB) exceeds your plan's per-import limit. Upgrade to import larger repos.`,
        kind: 'upload_too_large',
      };
    }
    const body = await readCappedBody(resp, maxBytes);
    if (body === 'too_large') {
      return {
        ok: false,
        status: 413,
        error: "That repository's archive exceeds your plan's per-import limit. Upgrade to import larger repos.",
        kind: 'upload_too_large',
      };
    }
    return { ok: true, buffer: body };
  }
  return {
    ok: false,
    status: 404,
    error: refExplicit
      ? `Couldn't find branch, tag, or commit "${ref}" in that repository.`
      : "Couldn't download the repository archive from GitHub.",
  };
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
 * POST /api/deployments/build-stage — upload, and if the project needs building,
 * run a REAL server-side build, then stage the output for preview + pin.
 *
 * - Already-deployable static / pre-built upload → staged immediately
 *   (needsBuild:false), exactly like /stage.
 * - package.json with a `build` script → a sandboxed build job is queued
 *   (202 + jobId); the client polls GET /builds/:jobId for streamed logs and the
 *   resulting stage. We never fake the build — failures surface the real logs.
 * - Otherwise → honest halt (no build script and no static entry point).
 */
deploymentsRouter.post(
  '/build-stage',
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

      await respondBuildOrStage(res, {
        userId: req.user!.id,
        projectId,
        projectName: project.name,
        user,
        allFiles,
        rawUploadBytes: Number(rawUploadSize),
      });
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        res.status(413).json({ error: err.message, kind: 'upload_too_large' });
        return;
      }
      logger.error('Failed to process build-stage upload', { error: err });
      res.status(500).json({ error: 'Failed to process upload' });
    }
  },
);

/**
 * POST /api/deployments/backend-deploy — request a server-side backend (a
 * service + Postgres database) for a project that needs one.
 *
 * PAID TIERS ONLY — Free plans are front-end (IPFS) only. The paid-tier gate is
 * ENFORCED here server-side so a tampered client can't provision a backend.
 *
 * Phase 2 status: detection + gating are live. The actual provider provisioning
 * (create service + Postgres, enable scale-to-zero, deploy code, capture public
 * URL) is wired in once the operator's provider workspace can provision —
 * verified live on a disposable project with teardown. Until then this degrades
 * HONESTLY with a 503 instead of faking a backend that doesn't exist.
 */
deploymentsRouter.post(
  '/backend-deploy',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = z.object({ projectId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'projectId is required' });
      return;
    }
    const { projectId } = parsed.data;

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

      // PAID TIERS ONLY. Reload from the DB (never trust the client) and reject
      // Free with a clear, honest upgrade prompt — the front-end stays on IPFS.
      if (user.tier === 'FREE') {
        res.status(402).json({
          error:
            'Deploying with a backend (server + database) requires a paid plan. Upgrade to add one — your front-end stays on IPFS either way.',
          kind: 'tier_required',
        });
        return;
      }

      // Honest integration availability: no provider token → unavailable, not faked.
      if (!isRailwayConfigured()) {
        res.status(503).json({
          error:
            'Backend deployments are temporarily unavailable. Your front-end can still deploy to IPFS.',
          kind: 'backend_unavailable',
        });
        return;
      }

      // Live provisioning is finalized once the provider workspace can provision
      // (verified on a disposable project + teardown). Until then degrade
      // honestly rather than fake a server. No DB row is created for a backend
      // that doesn't exist.
      logger.info('Backend deploy requested (provisioning not yet enabled)', {
        projectId,
        tier: user.tier,
      });
      res.status(503).json({
        error:
          "Backend deployments aren't available yet — this is being finalized. Your front-end can still deploy to IPFS now.",
        kind: 'backend_unavailable',
      });
    } catch (err) {
      logger.error('Backend deploy request failed', { error: err });
      res.status(500).json({ error: 'Failed to process the backend deploy request.' });
    }
  },
);

/**
 * POST /api/deployments/import-github — import a PUBLIC GitHub repo by URL and
 * run it through the exact same stage-or-build pipeline as a file upload. No git
 * binary: the repo archive is fetched over HTTPS from codeload. Private repos are
 * gated honestly (they need a token we don't have) — never faked.
 */
deploymentsRouter.post(
  '/import-github',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = z
      .object({
        projectId: z.string().min(1),
        repoUrl: z.string().min(1),
        ref: z.string().trim().min(1).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'projectId and repoUrl are required.' });
      return;
    }
    const { projectId, repoUrl, ref } = parsed.data;

    const repoRef = parseGitHubRepo(repoUrl);
    if (!repoRef) {
      res.status(400).json({
        error: "That doesn't look like a GitHub repository URL. Use https://github.com/owner/repo.",
      });
      return;
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

      // 1) Resolve metadata (also honestly detects private / not-found repos).
      const explicitRef = ref ?? repoRef.ref;
      const meta = await fetchGitHubMeta(repoRef.owner, repoRef.repo);
      if (!meta.ok) {
        res.status(meta.status).json({ error: meta.error });
        return;
      }

      // 2) Download the archive, capped to the user's per-upload tier limit.
      const branch = explicitRef ?? meta.defaultBranch;
      const dl = await downloadRepoZip(
        repoRef.owner,
        repoRef.repo,
        branch,
        Boolean(explicitRef),
        maxUploadBytesForTier(user.tier),
      );
      if (!dl.ok) {
        res.status(dl.status).json({ error: dl.error, kind: dl.kind });
        return;
      }

      // 3) Extract with the same caps + ignore filter as a ZIP upload (the
      //    codeload archive nests everything under a single root which
      //    extractZipToFiles strips).
      let files: DeployFile[];
      try {
        files = extractZipToFiles(dl.buffer);
      } catch (err) {
        if (err instanceof UploadTooLargeError) {
          res.status(413).json({ error: err.message, kind: 'upload_too_large' });
          return;
        }
        throw err;
      }

      const rawUploadBytes = files.reduce((acc, f) => acc + f.buffer.length, 0);
      await respondBuildOrStage(res, {
        userId: req.user!.id,
        projectId,
        projectName: project.name,
        user,
        allFiles: files,
        rawUploadBytes,
      });
    } catch (err) {
      logger.error('Failed to import GitHub repository', { error: err });
      res.status(500).json({ error: 'Failed to import the repository.' });
    }
  },
);

/**
 * GET /api/deployments/builds/:jobId — poll a build's status, streamed logs, and
 * (on success) the resulting stage for preview + pin.
 */
deploymentsRouter.get(
  '/builds/:jobId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const jobId = getRouteParam(req.params.jobId);
    const job = getBuildJob(jobId, req.user!.id);
    if (!job) {
      res.status(404).json({ error: 'Build not found or expired.' });
      return;
    }
    res.json({
      status: job.status,
      packageManager: job.packageManager,
      logs: getBuildLogs(jobId, req.user!.id) ?? '',
      error: job.error,
      stage: job.stage,
    });
  },
);

// ─── Pi domain target + honest gateway verification (Feature C) ────────────────

type GatewayCheck = {
  /** True only when the gateway actually returned the content. */
  served: boolean;
  /**
   * True when the check is inconclusive (rate-limited / unreachable) rather than
   * a definitive "not served". The site may well be live — we just couldn't
   * confirm it this moment. Kept distinct so the UI never says "not live" when
   * it actually means "couldn't verify".
   */
  indeterminate: boolean;
  status: number | null;
  reason?: string;
};

/** Map a non-success HTTP status to an honest served:false result. */
function classifyGatewayStatus(status: number): GatewayCheck {
  if (status === 429) {
    return {
      served: false,
      indeterminate: true,
      status,
      reason:
        'The public IPFS gateway is rate-limiting verification right now — your site may already be live. Try again in a moment.',
    };
  }
  return { served: false, indeterminate: false, status, reason: `Gateway returned HTTP ${status}.` };
}

/**
 * REAL check that the public IPFS gateway actually serves the deployment's CID.
 * Tries a cheap HEAD first (following redirects — the public gateway 301s to a
 * subdomain), then a 1-byte ranged GET for gateways that reject HEAD. Never
 * fabricates a "connected" result: a non-2xx is reported truthfully, and a
 * rate-limit / network failure is flagged indeterminate (not "down").
 */
async function verifyGatewayServesCid(gatewayUrl: string): Promise<GatewayCheck> {
  try {
    const head = await fetch(gatewayUrl, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'Cherri-Hosting' },
      signal: AbortSignal.timeout(15_000),
    });
    if (head.ok) return { served: true, indeterminate: false, status: head.status };
    // HEAD is often blocked/unsupported (or rate-limited) — retry with a GET
    // unless the status is already a definitive answer.
    if (![403, 405, 429, 501].includes(head.status)) {
      return classifyGatewayStatus(head.status);
    }
  } catch {
    // network/timeout on HEAD — try a GET before giving up.
  }

  try {
    const get = await fetch(gatewayUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Cherri-Hosting', Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(20_000),
    });
    // Don't drain the body — we only need the status line.
    await get.body?.cancel().catch(() => undefined);
    if (get.ok || get.status === 206) return { served: true, indeterminate: false, status: get.status };
    return classifyGatewayStatus(get.status);
  } catch {
    return {
      served: false,
      indeterminate: true,
      status: null,
      reason:
        'Could not reach the IPFS gateway to verify — it may still be propagating. Try again shortly.',
    };
  }
}

/**
 * GET /api/deployments/:deploymentId/domain-target — return the EXACT values a
 * user points their .pi domain at (the gateway URL and the DNSLink TXT value
 * `dnslink=/ipfs/<cid>`), plus a REAL check that the gateway serves the CID.
 *
 * Honesty boundary: we can verify our gateway serves the content; we CANNOT
 * verify that a .pi name resolves to it (Pi Network controls .pi resolution and
 * exposes no public API), so the response never claims the domain is connected.
 */
deploymentsRouter.get(
  '/:deploymentId/domain-target',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const deploymentId = getRouteParam(req.params.deploymentId);
    try {
      const deployment = await prisma.deployment.findFirst({
        where: { id: deploymentId, project: { userId: req.user!.id } },
      });
      if (!deployment) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
      }
      if (!deployment.cid) {
        res.status(409).json({
          error: 'This deployment has no IPFS content yet. Deploy it to IPFS first.',
        });
        return;
      }

      const cid = deployment.cid;
      const gatewayUrl = deployment.gateway || `https://gateway.pinata.cloud/ipfs/${cid}`;
      const check = await verifyGatewayServesCid(gatewayUrl);

      res.json({
        cid,
        gatewayUrl,
        ipfsPath: `/ipfs/${cid}`,
        // Standard DNSLink TXT value for pointing a domain at IPFS content.
        dnslink: `dnslink=/ipfs/${cid}`,
        served: check.served,
        indeterminate: check.indeterminate,
        gatewayStatus: check.status,
        reason: check.reason,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Failed to build domain target', { error: err });
      res.status(500).json({ error: 'Failed to verify the deployment.' });
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
