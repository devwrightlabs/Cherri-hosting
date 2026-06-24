---
name: Phase 7 idle-DB cost control
description: How Cherri controls idle-database cost exposure — hard cap as primary defense, honest inert dormancy/snapshot seams, operator-only access.
---

# Idle-database cost control (WOODSTICK 3 Phase 7)

## The constraint that shapes everything
Railway exposes serviceDelete/deploymentStop + estimatedUsage but **NO native
snapshot/restore**. A DB "snapshot" must therefore be our own pg_dump over a
live connection string — which only exists once a DB is provisioned live.

**Decision:** the **hard cap on simultaneously-live DBs is the PRIMARY cost
defense**; snapshot→delete→wake/restore is built as an **honest INERT seam** that
records *_PENDING + reason and NEVER claims a snapshot stored / DB deleted /
restored until the live path exists.
**Why:** no native snapshot API + provisioning still gated on "Railway is paid".

## Hard rules (master-rule consequences)
- **Customer DB dumps = encrypted-to-PRIVATE-store only. Never raw public IPFS**
  (IPFS is public/immutable/content-addressed). Snapshot store is deferred —
  gated on `SNAPSHOT_STORE_PROVIDER` env (unset ⇒ seam stays inert).
- A "live DB" (counts against cap) = `railwayDbServiceId != null` AND
  `dbLifecycleStatus NOT IN (SNAPSHOTTED, DELETED)`. DORMANT_PENDING/DELETE_PENDING
  still bill ⇒ still counted. With provisioning deferred this is truthfully 0.
- **Dormancy must be measured from an observed window, never from `createdAt`.**
  First successful Railway poll sets `activityBaselineAt`; the reconciler counts
  inactivity from `lastProviderActivityAt ?? activityBaselineAt` and requires a
  *fresh* poll (freshness gate) — so one first poll on an old service can't be
  misread as days of inactivity, and a Railway outage can't trigger false
  dormancy. **Why:** architect flagged the createdAt version as a hard rule
  violation ("never mark dormant off first-observation/missing data").
- Activity signal = Railway estimatedUsage NETWORK_RX+TX delta vs stored
  `lastNetworkUsageGb` baseline; lower value ⇒ billing-period reset ⇒ re-baseline
  without claiming an activity time.

## Operator-only ("admin, me only") access
No admin/role concept existed. Operator = Pi user id in `OPERATOR_PI_USER_IDS`
env allowlist, enforced by `requireOperator` AFTER piAuthMiddleware. **Unset ⇒
honest 503 (never open-to-all); not-in-list ⇒ 403.** Operator alerts are a
separate `OperatorAlert` model (deduped via unique `dedupeKey`) because the
end-user Notification model requires a non-null userId.

## Cap-guard atomicity contract
`assertCapAllowsNewDb()` is a read-before-create check, NOT concurrency-safe
alone. When live provisioning is wired it MUST run inside the same
transaction/advisory lock (or serialized queue) that creates the DB row.

## Cost dashboard
Operator-only; monthly figures are explicitly ESTIMATES (Railway current-period
usage × env-overridable unit-cost facts in `railwayCostFacts.ts`), never a bill;
honest null + reason when Railway unconfigured/unreachable.
