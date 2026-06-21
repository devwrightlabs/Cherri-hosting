/**
 * Staging store
 *
 * Holds an uploaded, validated-but-not-yet-pinned site in memory between the
 * "validate & preview" step and the "deploy to IPFS" step. Consistent with the
 * existing multer memoryStorage approach: the upload already lives in memory
 * during processing, so we keep the deployable subset around briefly so the
 * preview iframe can render it and the pin step can read it back.
 *
 * Access is guarded by an unguessable stageId (24 random bytes). Stages expire
 * after a short TTL and are removed on successful pin.
 */

import crypto from 'crypto';
import type { DeployFile } from '../utils/deployFiles';

export interface Stage {
  id: string;
  userId: string;
  projectId: string;
  projectName: string;
  /** Folder prefix stripped from the deployable files (for reference/logging). */
  rootPrefix: string;
  /** Entry HTML file relative to the (stripped) root, e.g. 'index.html'. */
  entryPoint: string;
  /** Deployable files with root-stripped paths — what gets previewed and pinned. */
  files: DeployFile[];
  totalBytes: number;
  /** True while a pin is in flight — prevents concurrent double-pins. */
  pinning: boolean;
  createdAt: number;
  expiresAt: number;
}

const STAGE_TTL_MS = 20 * 60 * 1000; // 20 minutes

const stages = new Map<string, Stage>();

export function createStage(
  data: Omit<Stage, 'id' | 'pinning' | 'createdAt' | 'expiresAt'>,
): Stage {
  const id = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const stage: Stage = {
    ...data,
    id,
    pinning: false,
    createdAt: now,
    expiresAt: now + STAGE_TTL_MS,
  };
  stages.set(id, stage);
  return stage;
}

export function getStage(id: string): Stage | null {
  const s = stages.get(id);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    stages.delete(id);
    return null;
  }
  return s;
}

export function deleteStage(id: string): void {
  stages.delete(id);
}

export type ClaimResult =
  | { ok: true; stage: Stage }
  | { ok: false; reason: 'not_found' | 'pinning' };

/**
 * Atomically claim a stage for pinning. Returns the stage and marks it as
 * pinning so a concurrent or double-clicked /pin cannot create a second
 * deployment from the same upload (which would double-pin and bypass quota).
 * Node's single-threaded execution makes this check-and-set atomic.
 */
export function claimStage(id: string, userId: string): ClaimResult {
  const s = getStage(id);
  if (!s || s.userId !== userId) return { ok: false, reason: 'not_found' };
  if (s.pinning) return { ok: false, reason: 'pinning' };
  s.pinning = true;
  return { ok: true, stage: s };
}

/** Release a pinning claim so a failed pin can be retried. */
export function releaseStage(id: string): void {
  const s = stages.get(id);
  if (s) s.pinning = false;
}

// Periodic sweep so expired uploads don't linger in memory.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of stages) {
    if (s.expiresAt <= now) stages.delete(id);
  }
}, 5 * 60 * 1000);
sweep.unref?.();
