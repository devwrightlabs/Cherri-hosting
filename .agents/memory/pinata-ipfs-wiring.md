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

## Pin request shape: ONE shared root via `filepath`, never loose files
Pinata's `pinFileToIPFS` accepts exactly one file OR one directory. A directory
pin must append every multipart part with form-data's **`filepath`** option
under one shared root (`<root>/<relative path>`), with NO `wrapWithDirectory`.

**Why:** the `filename` option is passed through `path.basename()` by
form-data, silently stripping directory structure — every file becomes a loose
root-level entry and Pinata rejects with 400 "More than one file and/or
directory was provided for pinning". Even a "1-file" site hits this, because
hardening adds `404.html`. `wrapWithDirectory: true` does not rescue loose
entries, and combined with a shared root it would nest (`cid/<root>/…`) and
break the `<cid>/index.html` entryPath contract.

**How to apply:** the returned CID is the shared root's *contents* (the root
name never appears in URLs), so `<cid>/index.html` stays valid. Keep the pure
helpers (`buildDirectoryEntries` et al. in `services/ipfs.ts`) as the only way
to assemble the form, and pin even one-file bundles as a single directory for
a uniform URL contract. A wrong shape 404s at `<cid>/index.html`; the public
gateway's 403 (ERR_ID:00023) means the shape is RIGHT but HTML is blocked.

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
