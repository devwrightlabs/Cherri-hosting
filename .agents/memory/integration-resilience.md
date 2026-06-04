---
name: Integration resilience pattern
description: How external integrations (Pi Network, Pinata/IPFS, Postgres) are isolated so the app never crashes on missing config or timeouts.
---

# Integration resilience

All external-service availability checks live in `server/src/utils/integrations.ts`
(`isPiConfigured` / `isPinataConfigured` / `isDatabaseConfigured`,
`integrationStatus()`, and the `IntegrationUnavailableError` class).

**Rule:** missing optional config must never `process.exit`. Startup only WARNs;
the affected feature fails at call time with a structured HTTP 503.

**How to apply:**
- Server startup (`index.ts`) warns on missing DATABASE_URL / PI_API_KEY / Pinata creds, never exits.
- `prismaClient.ts` `$connect()` failure logs, does not exit.
- Pi service functions call `assertPiConfigured()` first; `ipfs.ts buildAuthHeaders` throws `IntegrationUnavailableError`.
- Routes catch `IntegrationUnavailableError` → `res.status(503).json({ error, integration })`.
- IPFS deploy routes (`deploy.ts`, `deployments.ts`) do a `isPinataConfigured()` PREFLIGHT 503 before creating a PENDING deployment — otherwise the deployment is accepted then silently flips to FAILED.
- `GET /api/status` returns `{ integrations: { pi, pinata, database } }` (public, no auth). Frontend `SystemStatusBanner` fetches it ONCE (no polling) to show a degraded-mode banner.

**Why:** user's #1 requirement is the web app stays up even when Pi/Pinata/DB are
unconfigured or time out. App must run with PI_API_KEY and PINATA_JWT both absent.

**uncaughtException policy** (`index.ts`): environment-aware. In production it
logs then `process.exit(1)` (deployment supervisor restarts clean). In
development it logs and stays alive (no supervisor; exiting would take the app
fully down, defeating the uptime goal). External-service errors are handled in
their own routes/services and shouldn't reach this handler.

## Domain separation (utility, not reseller)
Sherry is hosting infrastructure only. It must NEVER sell domains or process
domain bids/billing. Domain acquisition routes to Pi Network's OFFICIAL domain
auction via a redirection gateway (`client/src/components/dashboard/DomainGateway.tsx`,
opens `PI_DOMAIN_PORTAL_URL` from `client/src/lib/constants.ts`, configurable via
`VITE_PI_DOMAIN_PORTAL_URL`). UI copy says "Pi domain mapping" (mapping an
already-owned domain to a deployment's IPFS gateway/CID) — never "custom domain
support / point your CNAME to our gateway" (that framing reads as reseller).
**Why:** explicit product/compliance boundary — purchases happen on Pi Network, not here.

## Identity
Auth is strictly "Sign in with Pi" (Pi SDK). No traditional Sign Up / register /
email-password. Unauthenticated CTAs must trigger `signIn()` and read "Sign in with Pi".
