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
import { liveUrlForCid } from '../utils/gateway';

const PINATA_BASE = 'https://api.pinata.cloud';

/**
 * Build the Pinata auth header from server-side env vars ONLY (never read in
 * client/browser code). PINATA_JWT is the primary credential; the api-key/secret
 * pair is a fallback used only when the JWT is absent. If neither is present we
 * stop with an honest error instead of attempting a pin that would fail.
 */
function buildAuthHeaders(): Record<string, string> {
  const jwt = process.env.PINATA_JWT?.trim();
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }

  const apiKey = process.env.PINATA_API_KEY?.trim();
  const apiSecret = process.env.PINATA_API_SECRET?.trim();
  if (apiKey && apiSecret) {
    return {
      pinata_api_key: apiKey,
      pinata_secret_api_key: apiSecret,
    };
  }

  throw new IntegrationUnavailableError(
    'pinata',
    'Pinata/IPFS is not configured on the server. Set the PINATA_JWT secret (a Pinata Admin JWT), or both PINATA_API_KEY and PINATA_API_SECRET.',
  );
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
  // Derived from the CID: dedicated Pinata gateway when configured, else public.
  const gatewayUrl = liveUrlForCid(cid);

  logger.info('File pinned to IPFS', { cid, size, fileName });
  return { cid, gatewayUrl, size };
}

/**
 * Sanitize a project name into a safe single-segment root directory name for
 * the Pinata multipart upload. Pinata only needs SOME common root — the root's
 * name is not part of the returned CID — but it must be one clean path segment.
 */
export function sanitizePinRootName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return cleaned || 'site';
}

/**
 * Normalize a bundle-relative file path for the pin request: posix separators,
 * no leading `/` or `./`, no empty segments. Returns null for paths that are
 * empty or attempt traversal (`..`) — those must never reach Pinata.
 */
export function normalizeBundlePath(p: string): string | null {
  const segments = p
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.');
  if (segments.length === 0 || segments.some((seg) => seg === '..')) return null;
  return segments.join('/');
}

/**
 * Build the multipart entries for a directory pin: every file is placed under
 * ONE shared root directory (`<root>/<relative path>`).
 *
 * Why: Pinata's pinFileToIPFS accepts exactly one file OR one directory. The
 * previous implementation appended each file with the `filename` option, which
 * form-data passes through `path.basename()` — directory structure was
 * stripped and every file became a loose root-level entry, so any bundle with
 * more than one file (hardening alone adds 404.html) was rejected with
 * 400 "More than one file and/or directory was provided for pinning".
 * The `filepath` option is used verbatim, and a shared root makes the whole
 * upload a single directory. The returned CID is that directory's contents,
 * so entry files stay at `<cid>/index.html` — the root name never appears in
 * live URLs.
 */
export function buildDirectoryEntries(
  files: Array<{ buffer: Buffer; path: string; mimeType: string }>,
  dirName: string,
): Array<{ buffer: Buffer; filepath: string; mimeType: string }> {
  const root = sanitizePinRootName(dirName);
  const seen = new Set<string>();
  return files.map((file) => {
    const rel = normalizeBundlePath(file.path);
    if (!rel) {
      throw new Error(
        `This bundle contains a file path that can't be published safely ("${file.path}"). Rebuild and try again.`,
      );
    }
    // Two different inputs collapsing to one path (e.g. "./index.html" and
    // "index.html") would silently drop a file inside the pinned directory —
    // fail honestly instead.
    if (seen.has(rel)) {
      throw new Error(
        `This bundle contains two files that resolve to the same path ("${rel}"). Rebuild and try again.`,
      );
    }
    seen.add(rel);
    return { buffer: file.buffer, filepath: `${root}/${rel}`, mimeType: file.mimeType };
  });
}

/**
 * Pin multiple files as ONE directory to IPFS via Pinata.
 * Returns the root CID of the pinned directory. Works for any file count —
 * a one-file bundle is still a valid single-directory upload, keeping the
 * `<cid>/index.html` URL contract uniform.
 */
export async function pinDirectory(
  files: Array<{ buffer: Buffer; path: string; mimeType: string }>,
  dirName: string,
): Promise<PinResult> {
  const form = new FormData();

  for (const entry of buildDirectoryEntries(files, dirName)) {
    form.append('file', entry.buffer, {
      filepath: entry.filepath,
      contentType: entry.mimeType,
    });
  }

  form.append('pinataMetadata', JSON.stringify({ name: dirName }));
  // No wrapWithDirectory: the shared root above IS the single directory. An
  // extra wrap would nest it (cid/<root>/index.html) and break entry paths.
  form.append('pinataOptions', JSON.stringify({ cidVersion: IPFS_CID_VERSION }));

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
  // Derived from the CID: dedicated Pinata gateway when configured, else public.
  const gatewayUrl = liveUrlForCid(cid);

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
