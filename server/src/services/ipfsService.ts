import axios from 'axios';
import FormData from 'form-data';
import { logger } from '../utils/logger';

const PINATA_BASE = 'https://api.pinata.cloud';

function getAuthHeaders(): Record<string, string> {
  const jwt = process.env.PINATA_JWT;
  if (jwt) {
    return { Authorization: `Bearer ${jwt}` };
  }
  return {
    pinata_api_key: process.env.PINATA_API_KEY ?? '',
    pinata_secret_api_key: process.env.PINATA_API_SECRET ?? '',
  };
}

export interface PinResult {
  cid: string;
  gatewayUrl: string;
  size: number;
}

/**
 * Pin a single file buffer to IPFS via Pinata.
 */
export async function pinFileToIPFS(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<PinResult> {
  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: fileName,
    contentType: mimeType,
  });

  const metadata = JSON.stringify({ name: fileName });
  form.append('pinataMetadata', metadata);

  const options = JSON.stringify({ cidVersion: 1 });
  form.append('pinataOptions', options);

  const response = await axios.post<{ IpfsHash: string; PinSize: number }>(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    {
      headers: {
        ...getAuthHeaders(),
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      timeout: 60000,
    },
  );

  const cid = response.data.IpfsHash;
  const size = response.data.PinSize;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

  logger.info('File pinned to IPFS', { cid, size, fileName });
  return { cid, gatewayUrl, size };
}

/**
 * Pin a directory of files to IPFS via Pinata.
 * Returns the root CID of the pinned directory.
 */
export async function pinDirectoryToIPFS(
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

  const metadata = JSON.stringify({ name: dirName });
  form.append('pinataMetadata', metadata);

  const options = JSON.stringify({ cidVersion: 1, wrapWithDirectory: true });
  form.append('pinataOptions', options);

  const response = await axios.post<{ IpfsHash: string; PinSize: number }>(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    {
      headers: {
        ...getAuthHeaders(),
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      timeout: 120000,
    },
  );

  const cid = response.data.IpfsHash;
  const size = response.data.PinSize;
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;

  logger.info('Directory pinned to IPFS', { cid, size, dirName, fileCount: files.length });
  return { cid, gatewayUrl, size };
}

/**
 * Unpin a CID from Pinata (free up pinned storage).
 */
export async function unpinFromIPFS(cid: string): Promise<void> {
  await axios.delete(`${PINATA_BASE}/pinning/unpin/${cid}`, {
    headers: getAuthHeaders(),
    timeout: 15000,
  });
  logger.info('Unpinned CID from IPFS', { cid });
}
