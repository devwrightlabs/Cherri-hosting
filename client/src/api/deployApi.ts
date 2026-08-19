import axios, { AxiosError } from 'axios';
import { apiClient, API_BASE } from '../lib/api';
import { Deployment } from '../types';

// ─── Return types ────────────────────────────────────────────────────────────

export interface DeployFilesResult {
  id: string;
  status: string;
  projectId: string;
}

export type DeployErrorKind = 'storage_limit' | 'upload_too_large' | 'generic';

export interface DeployError {
  kind: DeployErrorKind;
  message: string;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

/**
 * POST /api/deployments — upload files and create a new deployment.
 *
 * @param projectId     The project to deploy to.
 * @param files         Files collected by the drop zone.
 * @param filePaths     Relative paths for each file (index-aligned with `files`).
 *                      For a folder drop, these preserve the directory structure
 *                      (e.g. ["src/index.html", "src/main.css"]).
 * @param onUploadProgress  Optional 0–100 progress callback.
 */
export async function deployFiles(
  projectId: string,
  files: File[],
  filePaths: string[],
  onUploadProgress?: (percent: number) => void,
): Promise<DeployFilesResult> {
  const formData = new FormData();
  formData.append('projectId', projectId);

  // Relative paths are sent as a JSON array so the server can reconstruct the
  // directory tree regardless of how the browser encodes filenames in
  // Content-Disposition.
  formData.append('filePaths', JSON.stringify(filePaths));

  files.forEach((f, i) => {
    // Use the relative path as the multipart filename for maximum compatibility.
    formData.append('files', f, filePaths[i] ?? f.name);
  });

  const res = await apiClient.post('/deployments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180_000,
    onUploadProgress: onUploadProgress
      ? (event) => {
          if (event.total) {
            onUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        }
      : undefined,
  });

  return (res.data as { deployment: DeployFilesResult }).deployment;
}

/**
 * GET /api/deployments/:id — fetch the current state of a deployment.
 */
export async function getDeployment(id: string): Promise<Deployment> {
  const res = await apiClient.get(`/deployments/${id}`);
  return (res.data as { deployment: Deployment }).deployment;
}

/**
 * POST /api/deployments/:id/verify-live — re-run the server's honest
 * live-link check (body-sniffing GET against the real gateway URL).
 */
export async function verifyLive(id: string): Promise<Deployment> {
  const res = await apiClient.post(`/deployments/${id}/verify-live`);
  return (res.data as { deployment: Deployment }).deployment;
}

// ─── Staging (validate + preview before pinning) ─────────────────────────────

export interface FileTreeEntry {
  path: string;
  size: number;
}

export interface PiSdkScan {
  scriptDetected: boolean;
  initDetected: boolean;
  ready: boolean;
}

export interface StageResult {
  deployable: boolean;
  /** Present when deployable=false — user-facing guidance, NOT an error. */
  haltReason?: string;
  /**
   * Present when deployable=false — a stable discriminator for the halt
   * (e.g. 'backend' | 'monorepo' | 'no-build' | 'unbuilt-entry' | 'no-entry').
   * Advisory; the UI uses `overridable` to decide what to offer.
   */
  haltKind?: string;
  /**
   * Present when deployable=false — true when the user may proceed past the halt
   * anyway (e.g. a monorepo warning with a usable root build script). When true,
   * re-submit with acknowledgeWarnings=true to build regardless.
   */
  overridable?: boolean;
  /** Present when deployable=true — opaque handle for preview + pin. */
  stageId?: string;
  projectType: string;
  rootPrefix?: string;
  entryPoint?: string | null;
  fileCount: number;
  totalBytes: number;
  fileTree: FileTreeEntry[];
  sdk?: PiSdkScan;
  /**
   * Whether a `validation-key.txt` was found at the served root. Pi Network
   * needs this file to verify `.pi` domain ownership. Advisory only — its
   * absence never blocks a deploy, but the UI surfaces a warning. Present on
   * deployable stages; undefined on halt responses.
   */
  hasValidationKey?: boolean;
  /** Server path of the sandboxed preview, e.g. "/preview/<id>/". */
  previewPath?: string;
}

/**
 * POST /api/deployments/stage — upload + validate WITHOUT pinning.
 *
 * Returns a deployable stage (with a sandboxed preview) or a halt reason when
 * the upload isn't a deployable static site (e.g. needs to be built first). A
 * halt is a normal `deployable: false` response, not a thrown error.
 */
export async function stageDeploy(
  projectId: string,
  files: File[],
  filePaths: string[],
  onUploadProgress?: (percent: number) => void,
): Promise<StageResult> {
  const formData = new FormData();
  formData.append('projectId', projectId);
  formData.append('filePaths', JSON.stringify(filePaths));
  files.forEach((f, i) => {
    formData.append('files', f, filePaths[i] ?? f.name);
  });

  const res = await apiClient.post('/deployments/stage', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180_000,
    onUploadProgress: onUploadProgress
      ? (event) => {
          if (event.total) {
            onUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        }
      : undefined,
  });

  return res.data as StageResult;
}

/**
 * POST /api/deployments/:stageId/pin — pin a previously staged upload to IPFS.
 */
export async function pinStaged(stageId: string): Promise<DeployFilesResult> {
  const res = await apiClient.post(`/deployments/${stageId}/pin`);
  return (res.data as { deployment: DeployFilesResult }).deployment;
}

// ─── "Configure for Pi" stage helpers ────────────────────────────────────────

/**
 * Client-side mirror of the server's validation-key plausibility check: one
 * long unbroken token of URL-safe characters. Trim before testing. Kept in
 * sync with `isPlausibleValidationKey` on the server so the input can reject
 * obvious non-keys instantly with the same message the server would send.
 */
export function isPlausibleValidationKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{20,512}$/.test(key);
}

/** Refreshed verification facts returned after a stage helper mutation. */
export interface StageHelperResult {
  hasValidationKey: boolean;
  sdk: PiSdkScan;
  fileCount: number;
  totalBytes: number;
}

/**
 * POST /api/deployments/stages/:stageId/validation-key — write the pasted Pi
 * validation key as validation-key.txt at the staged site's root.
 */
export async function addStageValidationKey(
  stageId: string,
  key: string,
): Promise<StageHelperResult> {
  const res = await apiClient.post(`/deployments/stages/${stageId}/validation-key`, { key });
  return res.data as StageHelperResult;
}

export interface PiSdkInjectResult extends StageHelperResult {
  /** True when the site already loaded the SDK / called Pi.init — nothing was injected. */
  alreadyPresent: boolean;
  injected: boolean;
  env: 'testnet' | 'mainnet';
  sandbox: boolean;
}

/**
 * POST /api/deployments/stages/:stageId/pi-sdk — inject the Pi SDK script +
 * Pi.init() into the staged site's entry HTML. Detect-before-inject: a site
 * that already has the SDK comes back with alreadyPresent:true, untouched.
 */
export async function addStagePiSdk(
  stageId: string,
  env: 'testnet' | 'mainnet',
): Promise<PiSdkInjectResult> {
  const res = await apiClient.post(`/deployments/stages/${stageId}/pi-sdk`, { env });
  return res.data as PiSdkInjectResult;
}

/** Result of the post-deploy served-file confirmation for validation-key.txt. */
export interface ValidationKeyCheck {
  /** The exact public URL that was fetched. */
  url: string;
  /** True only when the gateway actually returned the file. */
  served: boolean;
  /** True when the check was inconclusive (rate-limit / network) — NOT "down". */
  indeterminate: boolean;
  status: number | null;
  reason?: string;
  /** True/false when an expected key was compared; null = reachability only. */
  matches: boolean | null;
  checkedAt: string;
}

/**
 * GET /api/deployments/:deploymentId/validation-key-check — REAL check that
 * `<site>/validation-key.txt` is served by the gateway, optionally comparing
 * against the key pasted this session.
 */
export async function checkValidationKey(
  deploymentId: string,
  expected?: string,
): Promise<ValidationKeyCheck> {
  const res = await apiClient.get(`/deployments/${deploymentId}/validation-key-check`, {
    params: expected ? { expected } : undefined,
    timeout: 30_000,
  });
  return res.data as ValidationKeyCheck;
}

// ─── Server-side build (Vercel-style) ────────────────────────────────────────

export type BuildStatus =
  | 'QUEUED'
  | 'INSTALLING'
  | 'BUILDING'
  | 'COLLECTING'
  | 'DONE'
  | 'FAILED';

/**
 * Response of POST /build-stage. Either the upload was already deployable and is
 * staged immediately (needsBuild:false → a normal StageResult), or a real
 * server-side build was queued (needsBuild:true → poll getBuild with the jobId).
 */
export type BuildStageResult =
  | ({ needsBuild: false } & StageResult)
  | { needsBuild: true; jobId: string; packageManager: string };

/** A build job's live state — its real streamed logs and, on success, its stage. */
export interface BuildJobInfo {
  status: BuildStatus;
  packageManager: string;
  logs: string;
  error?: string;
  stage?: {
    stageId: string;
    previewPath: string;
    entryPoint: string;
    projectType: string;
    fileCount: number;
    totalBytes: number;
    sdk: PiSdkScan;
    hasValidationKey: boolean;
  };
}

/**
 * POST /api/deployments/build-stage — upload, and if the project needs building,
 * run a REAL server-side build before staging. Static/pre-built uploads are
 * staged immediately. Never fakes a build — failures surface the real logs.
 */
export async function buildStage(
  projectId: string,
  files: File[],
  filePaths: string[],
  onUploadProgress?: (percent: number) => void,
  acknowledgeWarnings = false,
): Promise<BuildStageResult> {
  const formData = new FormData();
  formData.append('projectId', projectId);
  formData.append('filePaths', JSON.stringify(filePaths));
  // Set only when proceeding past an overridable shape warning (e.g. monorepo).
  if (acknowledgeWarnings) formData.append('acknowledgeWarnings', 'true');
  files.forEach((f, i) => {
    formData.append('files', f, filePaths[i] ?? f.name);
  });

  const res = await apiClient.post('/deployments/build-stage', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180_000,
    onUploadProgress: onUploadProgress
      ? (event) => {
          if (event.total) {
            onUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        }
      : undefined,
  });

  return res.data as BuildStageResult;
}

/**
 * GET /api/deployments/builds/:jobId — poll a build's status + streamed logs.
 */
export async function getBuild(jobId: string): Promise<BuildJobInfo> {
  const res = await apiClient.get(`/deployments/builds/${jobId}`);
  return res.data as BuildJobInfo;
}

/**
 * True when a build poll failed because the job is gone — not found or expired
 * (server returns 404). This is terminal for a reconnect: the persisted job no
 * longer exists, so the client must clear it and stop polling rather than retry
 * a dead job forever. Distinct from transient network errors, which are retried.
 */
export function isBuildGoneError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

/**
 * POST /api/deployments/import-github — import a PUBLIC GitHub repo by URL and
 * run it through the same stage-or-build pipeline. Returns the same result shape
 * as buildStage (immediate stage, or a queued build to poll). Private/not-found
 * repos surface an honest server error, never a faked import.
 */
export async function importGitHub(
  projectId: string,
  repoUrl: string,
  ref?: string,
  acknowledgeWarnings = false,
): Promise<BuildStageResult> {
  const res = await apiClient.post(
    '/deployments/import-github',
    {
      projectId,
      repoUrl,
      ref: ref?.trim() ? ref.trim() : undefined,
      // Set only when proceeding past an overridable shape warning (e.g. monorepo).
      acknowledgeWarnings: acknowledgeWarnings ? true : undefined,
    },
    { timeout: 180_000 },
  );
  return res.data as BuildStageResult;
}

/**
 * Absolute URL for the sandboxed preview iframe. The preview is served by the
 * API origin (outside `/api`), so it must be loaded from API_BASE rather than
 * resolved against the SPA's own routes.
 */
export function previewUrl(previewPath: string): string {
  return `${API_BASE}${previewPath}`;
}

// ─── Error normalisation ─────────────────────────────────────────────────────

export function extractDeployError(err: unknown): DeployError {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ error?: string; kind?: string }>;
    const serverMessage = axErr.response?.data?.error;
    const status = axErr.response?.status;

    if (status === 402) {
      return {
        kind: 'storage_limit',
        message: serverMessage ?? 'Storage quota exceeded. Upgrade to get more IPFS storage.',
      };
    }

    if (status === 413) {
      return {
        kind: 'upload_too_large',
        message: serverMessage ?? 'Upload size exceeds your plan limit. Upgrade to deploy larger projects.',
      };
    }

    // The server responded with an error body — surface its real message. This
    // is where honest Pinata failures (e.g. "Pinata error 401: invalid JWT")
    // reach the user instead of a generic placeholder.
    if (serverMessage) {
      return { kind: 'generic', message: serverMessage };
    }

    // The server responded, but without a usable message body.
    // Never surface the raw HTTP status code — map it to plain language.
    if (status === 401 || status === 403) {
      return { kind: 'generic', message: 'You are not authorised to do this. Try signing in again.' };
    }
    if (status === 404) {
      return { kind: 'generic', message: 'The resource you requested was not found. It may have been deleted.' };
    }
    if (status === 429) {
      return { kind: 'generic', message: 'Too many requests. Please wait a moment and try again.' };
    }
    if (status && status >= 500) {
      return { kind: 'generic', message: 'Something went wrong on our end. Please try again in a moment.' };
    }
    if (status) {
      return { kind: 'generic', message: 'The request could not be completed. Please try again.' };
    }

    // No response at all — a true network-level failure. Never surface axios's
    // bare "Network Error"; explain what actually happened.
    if (axErr.code === 'ECONNABORTED' || /timeout/i.test(axErr.message)) {
      return {
        kind: 'generic',
        message:
          'The request timed out before the server responded. Your upload may be large or the connection slow — please try again.',
      };
    }

    return {
      kind: 'generic',
      message: "Couldn't reach the Cherri server. Check your internet connection and try again.",
    };
  }

  return {
    kind: 'generic',
    message: err instanceof Error ? err.message : 'Deployment failed. Please try again.',
  };
}
