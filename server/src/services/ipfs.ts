/**
 * Phase 3: IPFS Pinning Service
 *
 * Connects to Pinata (a managed IPFS pinning service) and provides helpers to
 * pin uploaded file buffers, returning the content identifier (CID / IPFS hash)
 * and a public gateway URL so the uploaded asset can be accessed immediately.
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
  return {
    pinata_api_key: process.env.PINATA_API_KEY ?? '',
    pinata_secret_api_key: process.env.PINATA_API_SECRET ?? '',
  };
}

export interface IpfsPinResult {
  /** IPFS content identifier (CID / hash) */
  ipfsHash: string;
  /** Public Pinata gateway URL for the pinned content */
  gatewayUrl: string;
  /** Size of the pinned content in bytes */
  size: number;
}

/**
 * Pin a single file buffer to IPFS via Pinata.
 * Returns the IPFS hash, a public gateway URL, and the pinned size.
 */
export async function pinUpload(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<IpfsPinResult> {
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

  const ipfsHash = response.data.IpfsHash;
  const size = response.data.PinSize;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

  logger.info('File pinned to IPFS', { ipfsHash, size, fileName });
  return { ipfsHash, gatewayUrl, size };
}

/**
 * Pin multiple files as a directory to IPFS via Pinata.
 * Returns the root CID of the pinned directory.
 */
export async function pinDirectory(
  files: Array<{ buffer: Buffer; path: string; mimeType: string }>,
  dirName: string,
): Promise<IpfsPinResult> {
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

  const ipfsHash = response.data.IpfsHash;
  const size = response.data.PinSize;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;

  logger.info('Directory pinned to IPFS', { ipfsHash, size, dirName, fileCount: files.length });
  return { ipfsHash, gatewayUrl, size };
}

/**
 * Unpin a CID from Pinata to free up pinned storage.
 */
export async function unpinUpload(ipfsHash: string): Promise<void> {
  await axios.delete(`${PINATA_BASE}/pinning/unpin/${ipfsHash}`, {
    headers: buildAuthHeaders(),
    timeout: 15_000,
  });
  logger.info('Unpinned from IPFS', { ipfsHash });
}
