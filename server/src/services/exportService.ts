/**
 * Phase 10 data portability — the no-lock-in promise, honestly implemented.
 *
 * Two exports, deliberately different in mechanism:
 *
 *   SITE (always available): a deployed site already lives on public IPFS, so the
 *   user is never locked in — the CID + public gateway links ARE the export. On
 *   top of that we offer a best-effort CAR archive streamed straight from a public
 *   IPFS gateway. If the gateway can't produce the archive we say so honestly and
 *   still hand back the CID/links — we NEVER fabricate a zip.
 *
 *   DATABASE (sensitive): a pg_dump streamed DIRECTLY to the authenticated owner
 *   over HTTPS. Customer DB dumps must NEVER touch public IPFS. When there is no
 *   live database to dump we return an honest 503 — never an empty or fake file.
 *   The DB connection string is never logged.
 */
import { dumpDatabase } from './snapshotService';
import { resolveLiveDbUri } from './dbConnectionSeam';
import { IntegrationUnavailableError } from '../utils/integrations';
import { prisma } from '../utils/prismaClient';

/** Project not found / not the caller's, or no exportable site yet. */
export class ExportError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ExportError';
    this.status = status;
    this.code = code;
  }
}

const PINATA_GATEWAY = 'https://gateway.pinata.cloud';
// How long to wait on the gateway before falling back to the honest CID-only path.
const ARCHIVE_FETCH_TIMEOUT_MS = Number(process.env.SITE_ARCHIVE_TIMEOUT_MS ?? 20_000);

export interface SiteExportInfo {
  cid: string;
  /** Public gateway links — these alone guarantee no lock-in. */
  gatewayUrls: string[];
}

/**
 * Resolve the CID + public gateway links for a project's current live site.
 * Throws ExportError(404) when the project isn't the caller's, and ExportError
 * (409) when there is no ACTIVE deployment to export yet.
 */
export async function getSiteExportInfo(
  projectId: string,
  userId: string,
): Promise<SiteExportInfo> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) {
    throw new ExportError(404, 'not_found', 'Project not found.');
  }

  const deployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'ACTIVE', cid: { not: '' } },
    orderBy: { createdAt: 'desc' },
    select: { cid: true },
  });
  if (!deployment || !deployment.cid) {
    throw new ExportError(
      409,
      'no_active_deployment',
      'No live deployment to export yet — deploy your site first.',
    );
  }

  return {
    cid: deployment.cid,
    gatewayUrls: [
      `${PINATA_GATEWAY}/ipfs/${deployment.cid}`,
      `https://ipfs.io/ipfs/${deployment.cid}`,
      `https://dweb.link/ipfs/${deployment.cid}`,
    ],
  };
}

export type SiteArchive =
  | {
      ok: true;
      contentType: string;
      filename: string;
      /** Web ReadableStream of the CAR archive bytes from the gateway. */
      body: ReadableStream<Uint8Array>;
    }
  | { ok: false; reason: string };

/**
 * Best-effort fetch of a re-importable CAR archive for a CID from a public IPFS
 * gateway. Returns ok:false with an honest reason on any failure — the caller
 * still has the CID + gateway links, so this is an enhancement, never a promise.
 */
export async function fetchSiteArchive(cid: string): Promise<SiteArchive> {
  const url = `${PINATA_GATEWAY}/ipfs/${cid}?format=car`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARCHIVE_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { Accept: 'application/vnd.ipld.car' },
      signal: controller.signal,
    });
    if (!resp.ok || !resp.body) {
      return {
        ok: false,
        reason: `The IPFS gateway could not produce an archive (status ${resp.status}). Your files remain available at the CID and gateway links above.`,
      };
    }
    return {
      ok: true,
      contentType: 'application/vnd.ipld.car',
      filename: `${cid}.car`,
      body: resp.body,
    };
  } catch (err) {
    const reason =
      (err as Error).name === 'AbortError'
        ? 'The IPFS gateway timed out producing an archive. Your files remain available at the CID and gateway links above.'
        : `The IPFS gateway archive is unavailable right now (${(err as Error).message}). Your files remain available at the CID and gateway links above.`;
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

export interface DbExport {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Produce a pg_dump of the project's live database for direct streaming to the
 * authenticated owner. Throws ExportError(404) when the project isn't the
 * caller's, and IntegrationUnavailableError (-> honest 503) when there is no live
 * database connection to dump. Never writes to IPFS; never logs the URI.
 */
export async function getDbExport(projectId: string, userId: string): Promise<DbExport> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, backendService: true },
  });
  if (!project) {
    throw new ExportError(404, 'not_found', 'Project not found.');
  }

  const svc = project.backendService;
  if (!svc) {
    throw new IntegrationUnavailableError(
      'database',
      'No live database is available to export for this project.',
    );
  }

  const dbUri = await resolveLiveDbUri(svc);
  if (!dbUri) {
    throw new IntegrationUnavailableError(
      'database',
      'Your database export is not available yet — the live database connection is not ready.',
    );
  }

  const buffer = await dumpDatabase(dbUri);
  return {
    buffer,
    filename: `database-${projectId}.dump`,
    contentType: 'application/octet-stream',
  };
}
