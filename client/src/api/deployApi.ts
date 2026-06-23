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
  /** Present when deployable=true — opaque handle for preview + pin. */
  stageId?: string;
  projectType: string;
  rootPrefix?: string;
  entryPoint?: string | null;
  fileCount: number;
  totalBytes: number;
  fileTree: FileTreeEntry[];
  sdk?: PiSdkScan;
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
    if (status) {
      return {
        kind: 'generic',
        message: `The server returned an error (${status}). Please try again.`,
      };
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
