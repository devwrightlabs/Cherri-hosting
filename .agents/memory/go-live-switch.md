---
name: GO-LIVE master switch (backend lane)
description: How the operator flips the inert backend lane (provisioning/metering/dormancy/snapshot) live, and the exact keys each capability needs.
---

The whole backend lane (Railway provisioning, env wiring, metering, dormancy
detection, snapshot→delete→restore) ships fully coded but INERT. It only acts when
the DB master flag is on AND the specific capability's real-world keys are present.
A consumer that finds its capability disabled MUST take the honest path (503 /
*_PENDING / *_UNAVAILABLE / real error) — never fake success.

**Two-layer gate:**
- Master: `GoLiveConfig.goLiveEnabled` (DB singleton, default false) — flipped via the
  operator route (`PATCH /api/operator/go-live`, requires operator auth).
  `masterEnabled = goLiveEnabled && !hardDisabled`.
- Env kill switch: `BACKEND_LANE_HARD_DISABLE=true` force-disables everything
  regardless of the DB flag (emergency off).
- Per-capability: each also needs its own keys (below). `goLiveReadiness()` reports
  per-capability `{enabled, blockedReason, missing[]}`. Helpers:
  `isCapabilityEnabled(key)`, `getCapabilityReadiness(key)`, `isBackendLaneLive()`.

**Capability keys (`CapabilityKey`) and what each requires (on top of masterEnabled):**
- `provisioning` / `envWiring`: `RAILWAY_API_TOKEN` + operator `railwayPaidAttestation`
  flag + a backend template (`RAILWAY_BACKEND_TEMPLATE_REPO` or `RAILWAY_BACKEND_IMAGE`).
- `metering` / `dormancyDetection`: `RAILWAY_API_TOKEN`.
- `dormancySnapshotDelete` (destructive): all of provisioning's keys PLUS operator
  `costControlConfig.snapshotDeleteEnabled` + `SNAPSHOT_STORE_PROVIDER` (a PRIVATE
  store — never public IPFS) + `SNAPSHOT_ENCRYPTION_KEY`. No concrete store adapter is
  implemented yet, so even fully keyed it self-blocks honestly until one is added.

**Why:** the operator must be able to pay Railway + add keys and flip ONE switch, with
zero risk that a half-configured host fakes a charge/provision/snapshot. The destructive
snapshot/delete is double-gated so a live DB is deleted ONLY after a checksum-verified
STORED snapshot.

**How to apply:** when wiring any new live/billing/provisioning action, gate it on the
right capability (or `isBackendLaneLive()` for billing loops) and degrade honestly when
off. Billing loops (`billingScheduler`, `billingLifecycleReconciler`) gate the whole tick
on `isBackendLaneLive()`; `dormancyReconciler` gates on `dormancyDetection`; the metering
sampler self-gates inside `sampleAllUsage`.
