/**
 * Preview router (PUBLIC, no Pi auth)
 *
 * Serves a staged, not-yet-pinned site so the client can render it inside a
 * sandboxed iframe before the user commits to pinning it to IPFS.
 *
 * Why public: the preview iframe is intentionally rendered with
 * `sandbox="allow-scripts allow-forms"` (NO allow-same-origin), so it runs at an
 * opaque origin and cannot send the app's Authorization header. Access is
 * instead guarded by the unguessable stageId (24 random bytes) plus a short TTL.
 * Only the deployable subset of a stage is ever served, and never any secret.
 *
 * Mounted at `/preview` (outside `/api`) so it bypasses the API rate limiter — a
 * single preview can pull dozens of asset requests.
 */

import { Router, Request, Response } from 'express';
import nodePath from 'path';
import { getStage } from '../services/stagingStore';
import { getMimeType } from '../utils/deployFiles';
import { getRouteParam } from '../utils/routeParams';

export const previewRouter = Router();

function handlePreview(req: Request, res: Response): void {
  const stageId = getRouteParam(req.params.stageId);
  const stage = getStage(stageId);
  if (!stage) {
    res.status(404).type('text/plain').send('Preview expired or not found.');
    return;
  }

  // The path after the stageId (Express 4 wildcard → req.params[0]).
  let rel = ((req.params as Record<string, string>)[0] ?? '').split('?')[0];
  try {
    rel = decodeURIComponent(rel);
  } catch {
    // keep the raw value if it isn't valid percent-encoding
  }
  rel = rel.replace(/^\/+/, '');

  // Reject path traversal outright.
  if (rel.split('/').some((seg) => seg === '..')) {
    res.status(400).type('text/plain').send('Bad path.');
    return;
  }

  if (rel === '' || rel.endsWith('/')) rel += stage.entryPoint;

  let file = stage.files.find((f) => f.path === rel);

  // SPA fallback: an extensionless path is almost certainly a client-side route,
  // so serve the entry document and let the app router handle it.
  if (!file && nodePath.extname(rel) === '') {
    file = stage.files.find((f) => f.path === stage.entryPoint);
  }

  if (!file) {
    res.status(404).type('text/plain').send('Not found in preview.');
    return;
  }

  res.setHeader('Content-Type', file.mimeType || getMimeType(file.path));
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.buffer);
}

previewRouter.get('/:stageId', handlePreview);
previewRouter.get('/:stageId/*', handlePreview);
