/**
 * Private snapshot store adapter (Phase 7).
 *
 * Raw customer database dumps must NEVER be placed on public IPFS — they go to a
 * PRIVATE, encrypted store. This module defines the store contract and resolves
 * the configured provider. It is deliberately INERT until a concrete provider
 * adapter is implemented: with no provider configured `resolveSnapshotStore()`
 * returns null (caller takes the honest blocked path), and a provider name with
 * no implemented adapter throws loudly rather than silently no-opping.
 *
 * A snapshot is only ever trusted as STORED after `put` returns AND `verify`
 * confirms the bytes are present and checksum-intact — the orchestration never
 * deletes a live DB before that.
 */

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

  switch (provider.toLowerCase()) {
    // Concrete adapters (S3/GCS/etc.) are added here as they are implemented.
    // Until then, a configured-but-unimplemented provider must fail honestly.
    default:
      throw new SnapshotStoreError(
        `Snapshot store provider "${provider}" is configured but has no implemented adapter.`,
      );
  }
}
