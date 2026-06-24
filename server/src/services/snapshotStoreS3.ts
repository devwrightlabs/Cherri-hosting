/**
 * S3-compatible private snapshot store adapter (Phase 7).
 *
 * One adapter, many providers: AWS S3, Cloudflare R2, Google Cloud Storage (via
 * its S3 interop endpoint), MinIO, etc. The concrete provider is chosen purely by
 * config — SNAPSHOT_STORE_PROVIDER names the family and SNAPSHOT_S3_ENDPOINT (when
 * present) points at the non-AWS endpoint. Nothing about a specific vendor is
 * hardcoded.
 *
 * Honesty contract (WOODSTICK master rules):
 *   - The bytes handed to put() are ALREADY encrypted (AES-256-GCM via
 *     SNAPSHOT_ENCRYPTION_KEY) by snapshotService BEFORE they ever reach this
 *     module. This adapter only moves opaque ciphertext; it never sees plaintext
 *     and never writes to public IPFS.
 *   - Stays INERT until fully configured: with no provider/credentials,
 *     s3ConfigMissing() reports what's missing and resolveSnapshotStore() throws
 *     an honest SnapshotStoreError instead of pretending a dump was stored.
 *   - verify() re-reads the stored object and re-hashes it, so a snapshot is only
 *     trusted STORED once the bytes are confirmed present AND checksum-intact.
 */
import crypto from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { SnapshotStore, StoredObject } from './snapshotStore';

/**
 * Provider names that map to the S3-compatible adapter (case-insensitive),
 * split by whether a custom endpoint is mandatory. AWS S3 derives its endpoint
 * from the region, but every non-AWS S3-compatible provider (R2, GCS interop,
 * MinIO, or a generic "s3-compatible") only works when SNAPSHOT_S3_ENDPOINT is
 * supplied — so we require it for those, keeping readiness honest.
 */
const AWS_NATIVE_ALIASES = new Set(['s3', 'aws', 'aws-s3']);
const ENDPOINT_REQUIRED_ALIASES = new Set([
  's3-compatible',
  'r2',
  'cloudflare-r2',
  'gcs',
  'google-cloud-storage',
  'minio',
]);

function normProvider(provider: string): string {
  return provider.trim().toLowerCase();
}

export function isS3Provider(provider: string): boolean {
  const p = normProvider(provider);
  return AWS_NATIVE_ALIASES.has(p) || ENDPOINT_REQUIRED_ALIASES.has(p);
}

/** True when this provider is only usable with an explicit custom endpoint. */
function endpointRequiredFor(provider: string): boolean {
  return ENDPOINT_REQUIRED_ALIASES.has(normProvider(provider));
}

interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  prefix: string;
}

const env = (k: string): string | undefined => process.env[k]?.trim() || undefined;

/**
 * Required env that must be present for the S3 store to be usable. Returns the
 * names that are still missing (empty array = ready). region is always optional
 * (sensible default). endpoint is optional for AWS S3 but REQUIRED for non-AWS
 * S3-compatible providers (R2/GCS/MinIO/generic), so it is reported missing for
 * those when absent. `provider` defaults to SNAPSHOT_STORE_PROVIDER.
 */
export function s3ConfigMissing(provider?: string): string[] {
  const missing: string[] = [];
  if (!env('SNAPSHOT_S3_BUCKET')) missing.push('SNAPSHOT_S3_BUCKET');
  if (!env('SNAPSHOT_S3_ACCESS_KEY_ID')) missing.push('SNAPSHOT_S3_ACCESS_KEY_ID');
  if (!env('SNAPSHOT_S3_SECRET_ACCESS_KEY')) {
    missing.push('SNAPSHOT_S3_SECRET_ACCESS_KEY');
  }
  const p = provider ?? process.env.SNAPSHOT_STORE_PROVIDER ?? '';
  if (endpointRequiredFor(p) && !env('SNAPSHOT_S3_ENDPOINT')) {
    missing.push('SNAPSHOT_S3_ENDPOINT');
  }
  return missing;
}

function resolveS3Config(provider: string): S3Config {
  const missing = s3ConfigMissing(provider);
  if (missing.length > 0) {
    throw new Error(`missing required credentials: ${missing.join(', ')}`);
  }
  const endpoint = env('SNAPSHOT_S3_ENDPOINT');
  // R2/GCS-style custom endpoints expect region "auto"; AWS defaults us-east-1.
  const region = env('SNAPSHOT_S3_REGION') ?? (endpoint ? 'auto' : 'us-east-1');
  const forcePathStyle =
    (env('SNAPSHOT_S3_FORCE_PATH_STYLE') ?? 'false').toLowerCase() === 'true';
  let prefix = env('SNAPSHOT_S3_PREFIX') ?? '';
  if (prefix.endsWith('/')) prefix = prefix.slice(0, -1);
  return {
    bucket: env('SNAPSHOT_S3_BUCKET')!,
    region,
    endpoint,
    accessKeyId: env('SNAPSHOT_S3_ACCESS_KEY_ID')!,
    secretAccessKey: env('SNAPSHOT_S3_SECRET_ACCESS_KEY')!,
    forcePathStyle,
    prefix,
  };
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * S3 PutObject accepts at most 5 GiB in a single request. Larger dumps need a
 * multipart upload, which this adapter does not implement yet. Rather than emit a
 * cryptic provider error — or risk a truncated object that would later fail
 * verify() — we refuse oversized objects up front. The caller records the
 * snapshot FAILED and leaves the live DB intact (honest, never a silent loss).
 */
export const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Minimal structural surface of the S3 client used by this adapter. The real
 * `S3Client` satisfies it; tests inject an in-memory fake to exercise
 * put/get/verify/remove without any network calls.
 */
export type S3CommandClient = { send: (command: any) => Promise<any> };

class S3SnapshotStore implements SnapshotStore {
  readonly provider: string;
  private readonly client: S3CommandClient;
  private readonly cfg: S3Config;

  constructor(providerTag: string, cfg: S3Config, client?: S3CommandClient) {
    this.provider = providerTag;
    this.cfg = cfg;
    this.client =
      client ??
      new S3Client({
        region: cfg.region,
        ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
        forcePathStyle: cfg.forcePathStyle,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });
  }

  /** Full object key for a logical key, applying the optional prefix. */
  private objectKey(key: string): string {
    return this.cfg.prefix ? `${this.cfg.prefix}/${key}` : key;
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    if (data.length > MAX_SINGLE_PUT_BYTES) {
      throw new Error(
        `snapshot is ${data.length} bytes, over the ${MAX_SINGLE_PUT_BYTES}-byte ` +
          'single-upload limit; multipart upload is not yet supported',
      );
    }
    const Key = this.objectKey(key);
    const checksum = sha256(data);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key,
        Body: data,
        ContentType: 'application/octet-stream',
        // Record our content hash as metadata for operator-side auditing. The
        // authoritative integrity check is the re-hash in verify().
        Metadata: { sha256: checksum },
      }),
    );
    return { locationRef: Key, checksum, sizeBytes: data.length };
  }

  async get(locationRef: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: locationRef }),
    );
    if (!res.Body) {
      throw new Error(`snapshot object ${locationRef} returned no body`);
    }
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * True only when the object exists AND its stored bytes re-hash to the expected
   * checksum. Any missing/unreadable object yields false (never a throw) so the
   * orchestration treats it as not-intact and keeps the live DB.
   */
  async verify(locationRef: string, expectedChecksum: string): Promise<boolean> {
    try {
      const bytes = await this.get(locationRef);
      return sha256(bytes) === expectedChecksum;
    } catch {
      return false;
    }
  }

  async remove(locationRef: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: locationRef }),
    );
  }
}

/**
 * Build the S3-compatible store for a given provider tag. Throws (caller maps to
 * SnapshotStoreError) when credentials are incomplete — never returns a store
 * that would silently fail.
 */
export function createS3SnapshotStore(
  providerTag: string,
  client?: S3CommandClient,
): SnapshotStore {
  const cfg = resolveS3Config(providerTag);
  return new S3SnapshotStore(providerTag, cfg, client);
}
