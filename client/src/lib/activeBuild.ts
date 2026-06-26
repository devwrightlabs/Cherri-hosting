/**
 * Persistence for an in-progress server-side build so it survives the user
 * leaving the Deploy page — navigating to another route, backgrounding the app,
 * or switching to the Pi Browser and coming back.
 *
 * The build itself runs on the SERVER under a job id; the client only needs to
 * remember that id (plus enough to restore the page's stage) and resume polling
 * `GET /deployments/builds/:jobId` on return. We do NOT persist file contents —
 * a finished build is reconnected by its job id, never re-uploaded.
 *
 * Storage: localStorage (already used in this app for the auth token and Pi env)
 * with defensive try/catch — if it's unavailable, persistence simply no-ops and
 * the flow degrades to the previous "restart" behaviour rather than throwing.
 */

const KEY = 'cherri.activeBuild.v1';

export interface ActiveBuildRecord {
  /** Server job id to reconnect to via GET /deployments/builds/:jobId. */
  jobId: string;
  /** Which project the build belongs to — restores the project selector. */
  projectId: string;
  /** The Deploy-page stage to restore. Builds are persisted while in stage 1. */
  stage: 'building';
  /** Epoch ms the build was enqueued — used for the stale-record guard. */
  startedAt: number;
}

/**
 * A persisted build older than this is treated as certainly gone and ignored.
 * The server keeps a job pollable for 30 min after its last update and a build
 * runs at most ~10 min, so 60 min comfortably covers anything the server could
 * still return. A 404 from the server clears the record precisely regardless,
 * so this is only a backstop against truly stale records.
 */
export const ACTIVE_BUILD_MAX_AGE_MS = 60 * 60 * 1000;

export function saveActiveBuild(record: ActiveBuildRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    /* storage unavailable / quota — persistence is best-effort */
  }
}

export function loadActiveBuild(): ActiveBuildRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveBuildRecord> | null;
    if (
      !parsed ||
      typeof parsed.jobId !== 'string' ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.startedAt !== 'number'
    ) {
      clearActiveBuild();
      return null;
    }
    return {
      jobId: parsed.jobId,
      projectId: parsed.projectId,
      stage: 'building',
      startedAt: parsed.startedAt,
    };
  } catch {
    // Corrupt JSON or storage error — drop it so we never get stuck.
    clearActiveBuild();
    return null;
  }
}

export function clearActiveBuild(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore — nothing to clean up if storage is unavailable */
  }
}
