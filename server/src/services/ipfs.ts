/**
 * IPFS Pinning Service (Pinata)
 *
 * Single canonical module for pinning content to IPFS via Pinata. This file
 * consolidates the previous `ipfs.ts` and `ipfsService.ts` modules into one
 * source of truth.
 *
 * Public API:
 *   - pinFile(buffer, name, mimeType)            -> PinResult
 *   - pinDirectory(files[], dirName)             -> PinResult
 *   - unpin(cid)                                 -> void
 *
 * All functions return `{ cid, gatewayUrl, size }`. The CID field is the
 * canonical IPFS content identifier.
 */

import axios from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger';
import { IPFS_CID_VERSION } from '../utils/constants';
import { IntegrationUnavailableError } from '../utils/integrations';

const PINATA_BASE = 'https://api.pinata.cloud';

/** Build auth headers from environment variables (JWT preferred, fall back to key/secret). */
function buildAuthHeaders(): Record<string, string> {
  const jwt = process.env.PINATA_JWT;
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }

  const apiKey = process.env.PINATA_API_KEY;
  const apiSecret = process.env.PINATA_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new IntegrationUnavailableError(
      'pinata',
      'Pinata/IPFS is not configured on the server. Set PINATA_JWT or both PINATA_API_KEY and PINATA_API_SECRET.',
    );
  }

  return {
    pinata_api_key: apiKey,
    pinata_secret_api_key: apiSecret,
  };
}

export interface PinResult {
  /** IPFS content identifier (CID / hash) of the pinned content */
  cid: string;
  /** Public Pinata gateway URL for the pinned content */
  gatewayUrl: string;
  /** Size of the pinned content in bytes */
  size: number;
}

/**
 * Pin a single file buffer to IPFS via Pinata.
 * Returns the IPFS CID, a public gateway URL, and the pinned size.
 */
export async function pinFile(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<PinResult> {
  const form = new FormData();
  form.append('file', fileBuffer, { filename: fileName, contentType: mimeType });
  form.append('pinataMetadata', JSON.stringify({ name: fileName }));
  form.append('pinataOptions', JSON.stringify({ cidVersion: IPFS_CID_VERSION }));

  const response = await axios.post<{ IpfsHash: string; PinSize: number }>(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    {
      headers: { ...buildAuthHeaders(), ...form.getHeaders() },
      maxBodyLength: Infinity,
      timeout: 60_000,
    },
  );

  const cid = response.data.IpfsHash;
  const size = response.data.PinSize;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

  logger.info('File pinned to IPFS', { cid, size, fileName });
  return { cid, gatewayUrl, size };
}

/**
 * Pin multiple files as a directory to IPFS via Pinata.
 * Returns the root CID of the pinned directory.
 */
export async function pinDirectory(
  files: Array<{ buffer: Buffer; path: string; mimeType: string }>,
  dirName: string,
): Promise<PinResult> {
  const form = new FormData();

  for (const file of files) {
    // Use the file's relative path as the filename. When `wrapWithDirectory: true`
    // Pinata wraps all files in an outer directory — prefixing each file with
    // dirName would create double-nesting (dirName/dirName/file) and causes a 400.
    form.append('file', file.buffer, {
      filename: file.path,
      contentType: file.mimeType,
    });
  }

  form.append('pinataMetadata', JSON.stringify({ name: dirName }));
  form.append(
    'pinataOptions',
    JSON.stringify({ cidVersion: IPFS_CID_VERSION, wrapWithDirectory: true }),
  );

  let response: Awaited<ReturnType<typeof axios.post<{ IpfsHash: string; PinSize: number }>>>;
  try {
    response = await axios.post<{ IpfsHash: string; PinSize: number }>(
      `${PINATA_BASE}/pinning/pinFileToIPFS`,
      form,
      {
        headers: { ...buildAuthHeaders(), ...form.getHeaders() },
        maxBodyLength: Infinity,
        timeout: 120_000,
      },
    );
  } catch (err) {
    // Re-throw with Pinata's actual response body so it appears in the logs.
    if (axios.isAxiosError(err) && err.response) {
      logger.error('Pinata directory pin failed', {
        status: err.response.status,
        body: err.response.data,
        dirName,
        fileCount: files.length,
      });
    }
    throw err;
  }

  const cid = response.data.IpfsHash;
  const size = response.data.PinSize;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

  logger.info('Directory pinned to IPFS', { cid, size, dirName, fileCount: files.length });
  return { cid, gatewayUrl, size };
}

/**
 * Turn a thrown pin error into an honest, user-facing message.
 *
 * Surfaces Pinata's actual response (auth failure, storage limit, etc.) instead
 * of a generic "something went wrong", and never fabricates success.
 */
export function describePinError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as unknown;

    let detail = '';
    if (typeof data === 'string') {
      detail = data;
    } else if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      const e = d.error;
      if (e && typeof e === 'object') {
        const eo = e as Record<string, unknown>;
        detail = String(eo.details ?? eo.reason ?? '');
      } else if (typeof e === 'string') {
        detail = e;
      }
      if (!detail && typeof d.message === 'string') detail = d.message;
      if (!detail) {
        try {
          detail = JSON.stringify(d);
        } catch {
          detail = '';
        }
      }
    }
    detail = detail.slice(0, 300).trim();

    if (status === 401 || status === 403) {
      return `Pinata rejected the request (${status}). The server's Pinata credentials are invalid or lack permission.${detail ? ` ${detail}` : ''}`;
    }
    if (status) {
      return `Pinata error ${status}${detail ? `: ${detail}` : ''}`;
    }
    if (err.code === 'ECONNABORTED') {
      return 'Pinata timed out while pinning. Try again, or upload a smaller project.';
    }
    return `Could not reach Pinata: ${err.message}`;
  }

  if (err instanceof IntegrationUnavailableError) {
    return err.message;
  }

  return err instanceof Error ? err.message : 'Unknown error while pinning to IPFS.';
}

/**
 * Unpin a CID from Pinata to free up pinned storage.
 */
export async function unpin(cid: string): Promise<void> {
  await axios.delete(`${PINATA_BASE}/pinning/unpin/${cid}`, {
    headers: buildAuthHeaders(),
    timeout: 15_000,
  });
  logger.info('Unpinned from IPFS', { cid });
}
