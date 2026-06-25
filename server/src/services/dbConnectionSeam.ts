/**
 * The single wiring SEAM for resolving a provisioned app's live Postgres
 * connection string.
 *
 * Both the Phase 7 snapshot path and the Phase 10 backup path need a live DB URI
 * to export from (and a target URI to restore into). That URI only exists once
 * the GO-LIVE provisioning path actually provisions a real database and surfaces
 * its provider credentials here. Until then these return null, so every consumer
 * takes the honest blocked path and NEVER fakes an export/restore/backup.
 *
 * Centralising the seam guarantees snapshots and backups read the DB from the
 * exact same source — they can never diverge.
 */
import type { BackendService } from '@prisma/client';

/**
 * The live Postgres URI to EXPORT for a provisioned DB (snapshot or backup).
 * Null until the live provisioning path surfaces the provider's DB credentials.
 */
export async function resolveLiveDbUri(_svc: BackendService): Promise<string | null> {
  return null;
}

/**
 * The target Postgres URI to RESTORE INTO when waking a DB. Null until waking
 * re-provisions a fresh DB and exposes its URI here.
 */
export async function resolveRestoreTargetUri(_svc: BackendService): Promise<string | null> {
  return null;
}
