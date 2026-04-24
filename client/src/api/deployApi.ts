/**
 * Phase 6: Client-side deployment API utility.
 *
 * Provides typed wrappers around the backend deployment routes so that UI
 * components never touch axios directly.  Includes structured error
 * normalisation so the Dashboard can surface user-friendly messages for
 * storage-quota (HTTP 402) and upload-size (HTTP 413) failures.
 */

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
 * @param projectId      The project to deploy to.
 * @param files          Files selected / dropped by the user.
 * @param onUploadProgress  Optional callback receiving 0-100 as bytes are sent.
 */
export async function deployFiles(
  projectId: string,
  files: File[],
  onUploadProgress?: (percent: number) => void,
): Promise<DeployFilesResult> {
  const formData = new FormData();
  formData.append('projectId', projectId);
  files.forEach((f) => formData.append('files', f, f.name));

  const res = await apiClient.post('/deployments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000,
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
 * Used for status polling after the initial POST completes.
 */
export async function getDeployment(id: string): Promise<Deployment> {
  const res = await apiClient.get(`/deployments/${id}`);
  return (res.data as { deployment: Deployment }).deployment;
}

// ─── Error normalisation ─────────────────────────────────────────────────────

/**
 * Convert an Axios or generic error into a structured DeployError.
 *
 * HTTP 402 → storage quota exceeded  → kind: 'storage_limit'
 * HTTP 413 → file too large for tier  → kind: 'upload_too_large'
 * Everything else                     → kind: 'generic'
 */
export function extractDeployError(err: unknown): DeployError {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ error?: string }>;
    const serverMessage = axErr.response?.data?.error;
    const status = axErr.response?.status;

    if (status === 402) {
      return {
        kind: 'storage_limit',
        message:
          serverMessage ??
          'Storage quota exceeded. Please upgrade to Premium for more storage.',
      };
    }

    if (status === 413) {
      return {
        kind: 'upload_too_large',
        message:
          serverMessage ??
          'Upload size exceeds your plan limit. Upgrade to Premium for larger uploads.',
      };
    }

    if (serverMessage) {
      return { kind: 'generic', message: serverMessage };
    }
  }

  return {
    kind: 'generic',
    message:
      err instanceof Error ? err.message : 'Deployment failed. Please try again.',
  };
}
