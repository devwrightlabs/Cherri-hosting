---
name: Phase 2 backend provisioning (WOODSTICK 3)
description: How "Deploy with backend" detection + paid-tier gating is shipped, and why live provisioning is deferred.
---

Phase 2 is split: the **non-provisioning** parts are shipped; **live Railway
provisioning is deferred** until the operator's Railway workspace is on a paid
plan (Free plan can't provision — see railway-landlord.md).

Shipped now:
- `detectBackendNeed(files)` (server deployFiles): pure, read-only signal of
  whether a project needs a server (framework deps, server start script, Next
  without `output:'export'`, `pages/api`|`app/api`, a `server.*` entry).
- `BackendService` Prisma model (1:1 with Project, `onDelete: Cascade`).
- Build step surfaces `needsBackend` + `backendEligible` (`tier !== 'FREE'`).
- `POST /api/deployments/backend-deploy` enforces paid-only server-side
  (FREE → 402), then returns an **honest 503** (`backend_unavailable`).

**Why / invariants to keep consistent:**
- Detection only *offers* a backend; it never forces one. The front-end ALWAYS
  still pins to IPFS regardless of backend status — that path is unchanged.
- The backend-deploy route must NEVER fake a backend and must NOT create a
  `BackendService` row for a backend that doesn't exist. Rows are created only
  when real provisioning runs (post-upgrade).
- End users never see "Railway"/provider IDs — keep error copy provider-agnostic
  and never return `railway*Id`/connection strings to the client.
- Paid-tier gate is enforced by reloading the user from the DB, never the client.

**How to apply when provisioning is enabled:** drop the orchestration into the
backend-deploy route (createProject → Postgres → service → domain → sleep →
deploy → capture URL → persist ACTIVE), with reverse-order rollback on any
failure so no billable resource leaks. Verify live on a disposable project +
teardown first. Env-split (inject URL + DB conn into front-end/backend) is
Phase 3; metering is Phase 4 — do NOT build those here.
