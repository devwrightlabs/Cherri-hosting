---
name: Provider (Railway) outage resilience
description: How Cherri stays honest when the backend "landlord" (Railway) has an outage — monitor design, the resumable/adoptable provisioning state machine, and the outcome-routing honesty trap.
---

# Backend-provider (Railway) outage resilience

The per-app backends + Postgres ride on Railway, which has multi-hour outages. The
system must surface outages honestly (never fake provisioning/charge/IPFS success,
never leak that Cherri uses Railway) while the IPFS front-end stays live.

## Health monitor is in-memory tri-state (NOT a DB singleton)
**Rule:** the provider-health monitor holds `unknown | reachable | unreachable`
purely in memory.
**Why:** the status endpoint must work even if the DB is down, and a *persisted*
"healthy" could be a stale lie during an outage.
**How to apply:** feed it from two sources — a gated periodic probe AND an observer
on every real provider call. Classification: a network error/timeout (status 0,
`RailwayApiError.isOutage`) ⇒ `unreachable`; ANY HTTP/GraphQL/auth answer ⇒
`reachable` (the provider answered). The client-facing shape is fully sanitized
(generic "backend provider" message, no provider name/host/id/raw error).

## Observer seam avoids an import cycle
railway.ts must NOT import the monitor. It exposes `setRailwayOutcomeObserver` and
reports every call's outcome; bootstrap (index.ts) wires the monitor's recorder in.
Keep that direction — importing the monitor into railway.ts creates a cycle.

## Resumability depends on a DETERMINISTIC project name
**Rule:** the per-app provider project name is derived ONLY from the projectId
(`cherri-app-<projectId>`, no timestamp/random).
**Why:** if a create call times out but actually created the project, a later retry
must find and ADOPT it by exact name instead of creating a second billable project.
**How to apply:** on resume, adopt the project (listProjects/getProject by name) and
adopt the postgres/backend services by their fixed names; only run the missing steps.

## Outage state-machine honesty (the core contract)
- A provider OUTAGE at any step ⇒ stay `PROVISIONING`, schedule a capped-backoff
  retry, record a generic reason. NEVER mark `FAILED`, NEVER tear down (resources
  may be fine; tearing down mid-outage can orphan billable resources).
- A deploy that is not yet `SUCCESS` but not terminally failed ⇒ also deferred
  (the build may still finish) — never `ACTIVE`, never `FAILED`.
- A terminal deploy failure (`FAILED/CRASHED/REMOVED`) or any non-outage error ⇒
  `FAILED` + best-effort teardown so a broken partial provision stops billing.
- `ACTIVE` only after a VERIFIED `SUCCESS` deploy.

## Outcome-routing honesty trap (caused a real bug)
**Rule:** every provisioning outcome must be routed explicitly, and a
still-provisioning / outage-deferred backend must NEVER map to an "active" response.
**Why:** the entry function once returned a single `EXISTS` outcome for BOTH an
already-`ACTIVE` row and an in-flight `PROVISIONING` row, and the HTTP route mapped
`EXISTS` → `200 {status:'active'}`. After an outage deferred a row to
`PROVISIONING`, a user retry was falsely told the backend was active.
**How to apply:** keep `EXISTS` for genuinely ACTIVE rows only; return a distinct
pending outcome (`DEFERRED`) for in-flight `PROVISIONING` rows, and route it to an
honest pending response (HTTP 202, `status:'pending'`, no provider leak). When you
add a new `ProvisionOutcome`, add its route case in lockstep — the regression test
guarding "in-flight PROVISIONING ⇒ DEFERRED, never EXISTS/active" must stay green.

## Reconcilers are inert until GO-LIVE
The probe and the retry reconciler self-skip unless the backend lane is live AND
(for retries) the `provisioning` capability is enabled AND the monitor is reachable
(don't hammer a known-down provider). So everything is completely inert today.

## Testing the provisioning entry needs the capability ON
`provisionBackend()` returns `BLOCKED` before its existing-row logic unless the
`provisioning` capability is enabled. In tests, enable it with GO-LIVE on +
`railwayPaidAttestation: true` + a temporary `RAILWAY_BACKEND_IMAGE` env var (then
restore). The resumable workflow itself is testable via a `__setProvisioningRailwayFns`
seam that injects mock provider calls (mirrors deletionService's teardown seam).
