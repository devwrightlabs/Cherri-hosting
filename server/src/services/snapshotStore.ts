/**
 * Private snapshot store adapter (Phase 7).
 *
 * Raw customer database dumps must NEVER be placed on public IPFS — they go to a
 * PRIVATE, encrypted store. This module defines the store contract and resolves
 * the configured provider. The concrete S3-compatible implementation lives in
 * ./snapshotStoreS3 (AWS S3 / Cloudflare R2 / GCS / MinIO, chosen by config).
 *
 * It stays INERT until configured: with no provider `resolveSnapshotStore()`
 * returns null (caller takes the honest blocked path); with a known provider but
 * incomplete credentials, or an unknown provider, it THROWS SnapshotStoreError so
 * the operator is told the store isn't actually wired — we never pretend a dump
 * was stored against a non-existent backend.
 *
 * A snapshot is only ever trusted as STORED after `put` returns AND `verify`
 * confirms the bytes are present and checksum-intact — the orchestration never
 * deletes a live DB before that.
 */
import { isS3Provider, s3ConfigMissing, createS3SnapshotStore } from './snapshotStoreS3';

export class SnapshotStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotStoreError';
  }
}

export interface StoredObject {
  /** Opaque pointer to the object in the store (operator-only, never exposed). */
  locationRef: string;
  /** SHA-256 (hex) of the exact bytes the store persisted. */
  checksum: string;
  sizeBytes: number;
}

export interface SnapshotStore {
  /** Provider tag persisted on the DbSnapshot row (e.g. 's3', 'gcs'). */
  readonly provider: string;
  /** Upload already-encrypted bytes; returns a location + integrity checksum. */
  put(key: string, data: Buffer): Promise<StoredObject>;
  /** Fetch previously stored (encrypted) bytes by location ref. */
  get(locationRef: string): Promise<Buffer>;
  /** Confirm an object exists and its bytes match the expected checksum. */
  verify(locationRef: string, expectedChecksum: string): Promise<boolean>;
  /** Best-effort removal of a stored object. */
  remove(locationRef: string): Promise<void>;
}

/**
 * Resolve the configured private snapshot store, or null when none is set.
 *
 * Returns null (inert) when SNAPSHOT_STORE_PROVIDER is unset. When it names a
 * provider that has no concrete adapter yet, this THROWS SnapshotStoreError so
 * the operator is told the store isn't actually wired — we never pretend a dump
 * was stored against a non-existent backend.
 */
export function resolveSnapshotStore(): SnapshotStore | null {
  const provider = process.env.SNAPSHOT_STORE_PROVIDER?.trim();
  if (!provider) return null;

  if (isS3Provider(provider)) {
    const missing = s3ConfigMissing(provider);
    if (missing.length > 0) {
      throw new SnapshotStoreError(
        `Snapshot store provider "${provider}" is selected but not usable — ${missing.join(', ')} not set.`,
      );
    }
    return createS3SnapshotStore(provider);
  }

  // A provider name with no implemented adapter must fail honestly, never no-op.
  throw new SnapshotStoreError(
    `Snapshot store provider "${provider}" is configured but has no implemented adapter.`,
  );
}
