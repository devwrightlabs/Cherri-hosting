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
    throw new Error(
      'Pinata credentials are not configured. Set PINATA_JWT or both PINATA_API_KEY and PINATA_API_SECRET.',
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
    form.append('file', file.buffer, {
      filename: `${dirName}/${file.path}`,
      contentType: file.mimeType,
    });
  }

  form.append('pinataMetadata', JSON.stringify({ name: dirName }));
  form.append(
    'pinataOptions',
    JSON.stringify({ cidVersion: IPFS_CID_VERSION, wrapWithDirectory: true }),
  );

  const response = await axios.post<{ IpfsHash: string; PinSize: number }>(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    {
      headers: { ...buildAuthHeaders(), ...form.getHeaders() },
      maxBodyLength: Infinity,
      timeout: 120_000,
    },
  );

  const cid = response.data.IpfsHash;
  const size = response.data.PinSize;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

  logger.info('Directory pinned to IPFS', { cid, size, dirName, fileCount: files.length });
  return { cid, gatewayUrl, size };
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
