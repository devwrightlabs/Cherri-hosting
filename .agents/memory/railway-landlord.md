---
name: Railway landlord provisioning
description: How Cherri talks to Railway (the "landlord" that runs per-app backends + Postgres), token quirks, schema gotchas, and the cost-control rationale.
---

# Railway landlord

Railway runs per-app BACKEND services + Postgres on the operator's own account.
End users must NEVER see Railway — to them an app just "gets a backend + DB".

## API access
- Endpoint: `https://backboard.railway.com/graphql/v2`, auth `Authorization: Bearer <RAILWAY_API_TOKEN>`.
- The configured token is a **team token**: it authenticates as the workspace, so the `me` query returns "Not Authorized" by design. The top-level `projects` query works — use that (not `me`) to confirm connection / operate at project scope.
- Overridable via env: `RAILWAY_API_URL`, `RAILWAY_POSTGRES_IMAGE`.

## Schema gotchas (verified by introspection)
- **No Postgres/plugin mutation exists.** Provision a DB via `serviceCreate` with `source.image` (a Postgres image / template), not a dedicated mutation.
- Deploy from GitHub: `githubRepoDeploy(input:{projectId!,repo!,branch,environmentId})`. Redeploy a service: `serviceInstanceDeployV2(serviceId!,environmentId!,commitSha)`.
- Inject env vars: `variableUpsert(input:{projectId!,environmentId!,name!,value!,serviceId,skipDeploys})`.
- Lifecycle: `serviceDelete(id!,environmentId)`, `projectDelete(id!)`, `deploymentStop(id!)`.
- Usage/metering: `estimatedUsage`/`usage`/`projectServiceUsage` all require `measurements:[MetricMeasurement!]!` + date range + projectId/workspaceId.
- Volume backups (for snapshot/restore cost defense): `volumeInstanceBackupCreate`/`Restore`, `volumeInstancePITRRestore`.

## Cost-control reality (drives the design)
- Railway spend caps are **soft** (alerts, not hard stops) — Cherri must do its own metering + capping.
- Postgres runs 24/7 and bills continuously; scale-to-zero "App Sleeping" is unreliable for a prod DB. **Why:** this is why teardown (snapshot volume → delete service → restore on demand) is the real defense against idle-app cost, not relying on Railway sleep.
- Rough rates: ~$20/vCPU-mo, ~$10/GB-RAM-mo, ~$0.25/GB-vol-mo, egress ~$0.05–0.10/GB; billed per-second rounded up to the minute.
- No Replit integration exists for Railway — the token is a plain secret.

## Code seam
`server/src/services/railway.ts` is the single client: honest `RailwayApiError` (real HTTP status + GraphQL messages; status 0 = provider outage/timeout), `IntegrationUnavailableError` when token missing. `isRailwayConfigured()` is in `utils/integrations.ts` but is deliberately KEPT OUT of the public `integrationStatus()` (`/api/status` is unauthenticated; exposing Railway would leak the landlord to end users). Read methods are live-verified; mutations are schema-verified and first exercised live in Phase 2.
