import axios, { AxiosError } from 'axios';
import { apiClient } from '../lib/api';
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

    if (serverMessage) {
      return { kind: 'generic', message: serverMessage };
    }
  }

  return {
    kind: 'generic',
    message: err instanceof Error ? err.message : 'Deployment failed. Please try again.',
  };
}
