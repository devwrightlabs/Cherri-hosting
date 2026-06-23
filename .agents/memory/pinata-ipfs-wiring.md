---
name: Pinata IPFS wiring
description: How Cherri Hosting authenticates to Pinata and how real pin errors must reach the user across both deploy paths.
---

# Pinata IPFS wiring

## Auth credential precedence
`PINATA_JWT` is the **primary** credential (sent as `Authorization: Bearer <jwt>`).
The `PINATA_API_KEY` + `PINATA_API_SECRET` pair is a **fallback**, used only when
the JWT is absent. Pinata accepts *either* method per request — never both at once.

**Why:** standardizing on one source of truth avoids stale/mismatched keys silently
authenticating with the wrong account.

**How to apply:** `buildAuthHeaders()` (server/src/services/ipfs.ts) and
`isPinataConfigured()` (server/src/utils/integrations.ts) must stay in lockstep —
both **trim** all three env values so a whitespace-only secret never falsely
reports "configured" while the other rejects it. Fail fast with
`IntegrationUnavailableError` before any pin attempt if neither credential exists.

## Pinning is server-side only
There are no client-side Pinata calls. Pinning runs in the server's background
`executePin`, which persists the real error via `describePinError()` to
`Deployment.failureReason`. Never move pinning to the browser (CORS + key exposure).

## Surfacing real errors (kill the bare "Network Error")
Two things must hold so honest Pinata errors (401 invalid JWT / 403
NO_SCOPES_FOUND / 413 payload too large) reach the user instead of a generic
message:

1. Client `extractDeployError()` (client/src/api/deployApi.ts) must map axios
   errors with **no response** to an explicit message (connectivity / timeout),
   never let axios's bare `"Network Error"` string fall through.
2. **Both** deploy poll loops must store the deployment in `liveDeployment` on
   `FAILED` (not only `ACTIVE`) so `DeployReveal` can render
   `deployment.failureReason`:
   - `client/src/pages/Deploy.tsx` (staged flow)
   - `client/src/components/dashboard/QuickDeploy.tsx` (legacy one-shot flow)

**Why:** a regression once stored `liveDeployment` only on `ACTIVE` in QuickDeploy,
so failed dashboard deploys showed "Something went wrong while sealing your
site..." instead of the persisted Pinata error.
