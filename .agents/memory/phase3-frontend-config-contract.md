---
name: Cherri front-end config contract (Phase 3 env split)
description: How a backend URL is exposed to an IPFS-pinned front-end, and what Phase 3 deliberately deferred.
---

A project's front-end is pinned to public IPFS; its backend (when it has one)
runs on the landlord provider behind a public URL the static bundle can't know
at build time. Cherri injects it as RUNTIME config, just before pinning:

- `cherri.config.json` at the bundle root → `{ "backendUrl": "https://..." }`
  (a site can `fetch('/cherri.config.json')`).
- A single marked `<script data-cherri-config>` in the root `index.html` `<head>`
  → `window.__CHERRI__ = Object.freeze({ backendUrl })` (synchronous read).

**Why runtime config, NOT build-time env vars:** injecting `VITE_API_URL` /
`NEXT_PUBLIC_*` / `REACT_APP_*` requires guessing the var name the user's app
reads — framework-specific and unverifiable. The runtime convention is
deterministic and works for prebuilt + built outputs alike. It is a CONTRACT,
not magic: the app's own code (or a Cherri starter template/SDK) must read
`window.__CHERRI__.backendUrl` or `cherri.config.json` — injection alone does
not make an arbitrary app call its backend.

**Invariants:** only a validated PUBLIC http(s) URL is ever injected (never the
Postgres conn string, provider ids, or any secret — those are backend-only and
already stripped from uploads by shouldIgnoreFile). The URL is escaped for safe
`<script>` embedding (`<`,`>`,`&`,U+2028,U+2029) to prevent stored XSS, and URLs
carrying credentials (userinfo) are rejected. The injector is pure + idempotent.

**Deferred until live provisioning exists (do NOT fake):**
- Wiring the injector into the pin/build paths. It stays UNWIRED until a real
  ACTIVE `BackendService.publicUrl` exists. When wiring: call it just before
  createStage/pinDirectory, only for an authenticated owner whose BackendService
  is ACTIVE with a publicUrl. Source the URL ONLY from the trusted provider
  publicUrl; if any user/operator-supplied URL could ever reach it, also reject
  non-public hosts (localhost/private/link-local) at that point.
- `buildBackendEnv()` (backend env map: DATABASE_URL via Railway reference,
  PORT, NODE_ENV, user keys) — needs the provisioning path + a real encrypted
  user-secrets flow. Not built; no user-key UI exists yet.
- "Verify deployed front-end reaches its backend" — needs a live backend; a
  mocked URL / placeholder endpoint / fake BackendService row is NOT valid.
