---
name: Phase 10 data safety & portability
description: Honest-blocking rules for DB backups, site/DB export, and app deletion (Cherri Hosting).
---

# Phase 10 — data safety, portability & deletion

## Backup vs cost-control snapshot — two different paths, never conflate
- **Backup** (`backupService.createBackup`, model `DbBackup`) = NON-destructive data
  safety: EXPORT → encrypt → store.put → checksum verify → STORED. It NEVER deletes
  the live DB.
- **Snapshot** (`snapshotService.snapshotAndDelete`, model `DbSnapshot`) = cost
  control: snapshot then DELETE the live DB to stop billing.
- They share the **same** live-DB source via `dbConnectionSeam.resolveLiveDbUri` so
  they can never read from different places. The seam returns `null` today, so both
  self-block honestly and nothing is ever faked.

## Railway delete mutations return `Promise<boolean>` — false ≠ confirmed
**Rule:** `railway.deleteProject` / `deleteService` resolve to a boolean; a `false`
return is NOT a confirmed teardown. Treat `false` exactly like a thrown error.
**Why:** deletion originally only `await`ed them and ignored the result, so a
non-throwing `false` could let `deleteProjectFully` purge retry state and hard-delete
rows while the provider resource still existed (a fake "deleted"). `snapshotService`
already had the correct pattern (`if (!deleted) throw …`).
**How to apply:** after every provider mutation that returns a confirmation boolean,
`if (!ok) throw` (or push a failure) so the flow stays in its honest pending state
(DELETING / *_PENDING) and rows/retry state are retained.

## Owner-facing failure reasons must be generic
**Rule:** the field exposed to owners (`BackendService.lastBackupFailureReason`,
surfaced by `GET /api/projects/:id`) must be a generic, non-leaky message. Raw
provider / pg_dump / store error text stays ONLY on the internal row
(`DbBackup.failureReason`) and in server logs.
**Why:** once `resolveLiveDbUri` is live, raw dump/store errors can contain the DB
host/domain — leaking that to end users violates the never-leak-provider-IDs rule.
**Note:** honest *gating* reasons ("capability not enabled", "no provisioned DB",
"no private store") are safe to expose — they carry no provider identifiers.

## Export mechanics (the no-lock-in promise)
- **Site export = CID-first.** `getSiteExportInfo` returns the CID + public gateway
  links (that alone guarantees portability). A best-effort CAR archive is layered on
  top via a public gateway `?format=car`; on any failure it returns `ok:false` with an
  honest reason — NEVER a fabricated zip.
- **DB export = direct authed HTTPS stream** of `pg_dump`. Customer DB dumps must
  NEVER touch public IPFS. No live URI → honest 503 (`IntegrationUnavailableError`),
  never an empty/fake file. The connection string is never logged.

## Capability gating split (intentional)
- `databaseBackups`: master + RAILWAY token + private store + SNAPSHOT_ENCRYPTION_KEY.
  NOT gated on the destructive snapshotDelete flag / template / paid attestation —
  preserving data must not depend on the operator having enabled deletion.
- `providerTeardown`: master + RAILWAY token + Pinata only. Deliberately NOT gated on
  template/paid attestation so an owner can ALWAYS delete their app and stop billing
  the operator, regardless of provisioning state.

## Deletion ordering (deleteProjectFully)
mark DELETING → unpin every unique CID (gated on Pinata configured; 404/400 = already
gone) → Railway teardown (gated on `providerTeardown`; check booleans) → purge private
backups+snapshots via store.remove → ONLY if `failures.length === 0`, hard-delete rows
in a txn (deployments first — no cascade — then project cascades BackendService →
backups/snapshots/usageSamples). Any unconfirmed resource keeps rows + sets
`deletionFailureReason`, returns `{status:'DELETING'}`. An app with no backend
resources is a real full delete today.

## Test seams
`deletionService` exposes `__setUnpinFn` and `__setRailwayTeardownFns(partial|null)`
so deletion ordering/boolean handling is testable without real Pinata/Railway calls
(same pattern as `__setPirc2ChainClient`). Pass `null` to restore the real client.

## Deferred (not built — gating is off in prod today)
Idempotent deletion retry for already-deleted Railway resources (a partial teardown
followed by a store failure could wedge in DELETING because a re-delete may 404/false).
Acceptable now since the seam is null and `providerTeardown` is gated off; revisit when
the live DB/teardown wiring lands.
