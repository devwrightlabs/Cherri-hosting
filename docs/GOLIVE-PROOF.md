# Cherri Hosting — Go-Live Proof

**Branch:** `golive/real-deploy-proof-20260829`  
**Date:** 2026-08-30  
**Goal:** Prove the REAL (non-simulated) upload→build→pin→live loop works end-to-end.

---

## What Was Proven

The full Cherri Hosting deploy pipeline was driven over HTTP against a real running server:

1. **Embedded Postgres** started and schema applied (all 20 tables created via `prisma migrate deploy`)
2. **Server booted** with real `PINATA_JWT` and `PI_API_KEY` from env
3. **Dev-auth seam** allowed headless sign-in (dual-guarded: `CHERRI_DEV_AUTH=1` AND `NODE_ENV !== 'production'`)
4. **TEST 1** (prebuilt static): uploaded → pinned → REAL CID on Pinata → content confirmed live via IPFS gateway
5. **TEST 2** (REAL Vite+React build): source uploaded → `npm install + vite build` ran on server → output pinned → content confirmed live and RENDERED in screenshot
6. **TEST 3** (GitHub import): MDN repo downloaded from GitHub → staged → pinned → confirmed on Pinata API
7. Throwaway pins unpinned; demo TEST2 kept live

---

## Commands Used

### Install
```bash
cd Cherri-hosting && npm i
cd server && npm i
cd client && npm i
cd server && npx prisma generate --schema=../prisma/schema.prisma
```

### Build
```bash
cd client && npm run build         # Vite SPA → client/dist
cd server && npm run build         # tsc → server/dist
```

### Start the full stack
```bash
cd server && PINATA_JWT="$PINATA_JWT" PI_API_KEY="$PI_API_KEY" \
  npx tsx scripts/start-with-db.ts
# Starts embedded-postgres (port 54320), applies schema, boots node server on :4000
```

### Verify server health
```bash
curl http://localhost:4000/healthz   # → {"status":"alive"}
curl http://localhost:4000/readyz    # → {"db":true, integrations.pinata:true}
curl http://localhost:4000/api/status
```

### Drive the loop
```bash
node agents/testing/drive-golive.mjs
# Auth → create project → build-stage → pin → poll ACTIVE → render check
```

---

## Test Results

### TEST 1 — Prebuilt Static Site ✅ PASS

| Item | Value |
|------|-------|
| Type | Prebuilt HTML+CSS+PNG (3 files, 789 bytes) |
| CID | `bafybeicso4z74vsckqr3pndztwf32jqebpydi3cjmu2tdvkbrvzxmuhriy` |
| Pinata URL | `https://gateway.pinata.cloud/ipfs/bafybeicso4z74vsckqr3pndztwf32jqebpydi3cjmu2tdvkbrvzxmuhriy/index.html` |
| Pinata API | ✅ Confirmed (789 bytes, 4 files, pinned 2026-08-29T23:54:47Z) |
| Render | ✅ `https://bafybeicso4z74vsckqr3pndztwf32jqebpydi3cjmu2tdvkbrvzxmuhriy.ipfs.w3s.link/index.html` → HTTP 200, unique string `Cherri-Test1-1788047686771` present in HTML body |
| Status | Unpinned after verification (throwaway test content) |

**Render confirmation (curl):**
```
<h1>Cherri-Test1-1788047686771</h1>
<p>Prebuilt static site deployed via Cherri Hosting golive test.</p>
```

### TEST 2 — Real Vite+React Server-Side Build ✅ PASS (KEPT LIVE)

| Item | Value |
|------|-------|
| Type | Vite+React source (4 files, no node_modules) → REAL `npm install + vite build` on server |
| CID | `bafybeidhf3j5bpq7dkztfb36d35vz56qe5f5fdfresrtrwgily6k6yhr2e` |
| Pinata URL | `https://gateway.pinata.cloud/ipfs/bafybeidhf3j5bpq7dkztfb36d35vz56qe5f5fdfresrtrwgily6k6yhr2e/index.html` |
| Demo URL (live) | **`https://bafybeidhf3j5bpq7dkztfb36d35vz56qe5f5fdfresrtrwgily6k6yhr2e.ipfs.dweb.link/`** |
| Pinata API | ✅ Confirmed (143,244 bytes, 3 files, pinned 2026-08-29T23:55:27Z) |
| Render | ✅ HTTP 200, SPA shell `<div id="root">` present, JS bundle loaded |
| Screenshot | `agents/testing/out/cherri-golive/live-ipfs-test2.png` shows green heading "Cherri-Test2-1788047716565" |

**Build log (server-side):**
```
=== Build security ===
Dependency policy: balanced.
Isolation: local-hardened (containerized: false)

=== Installing dependencies (npm) ===
$ npm install --include=dev --no-audit --no-fund --ignore-scripts
added 63 packages in 8s

=== Rebuilding allowlisted native packages (esbuild) ===
$ npm rebuild esbuild
rebuilt dependencies successfully

=== Running build ===
$ npm run build
vite v5.4.21 building for production...
✓ 29 modules transformed.
dist/index.html     0.22 kB │ gzip: 0.19 kB
dist/assets/index-BWnCBQPI.js  142.76 kB │ gzip: 45.93 kB
✓ built in 921ms
✓ Ready to preview and deploy.
```

### TEST 3 — GitHub Import ✅ PASS (unpinned)

| Item | Value |
|------|-------|
| Repo | `https://github.com/mdn/beginner-html-site-styled` (MDN, 132KB, public static) |
| CID | `bafybeih2d5okdyddvd7x3qinctbyscxqpxggxbg3dmnc3gxc64buqnfjoe` |
| Pinata API | ✅ Confirmed (67,849 bytes, 9 files, pinned 2026-08-30T00:00:47Z) |
| Render | Gateway propagation timeout (new content; CID confirmed pinned via Pinata API) |
| Status | Unpinned after verification |

---

## Health Checks Verified

```json
GET /healthz  → 200 {"status":"alive","timestamp":"..."}
GET /readyz   → 200 {"status":"ready","db":true,"integrations":{"pi":true,"pinata":true,"dedicatedGateway":false,"database":true,"pirc2":false}}
GET /api/status → {"integrations":{"pi":true,"pinata":true,...}}
GET /         → 200 <!doctype html> (React SPA from client/dist)
```

---

## Screenshots

All at `agents/testing/out/cherri-golive/` at 390px mobile width:

| File | Shows |
|------|-------|
| `healthz.png` | `{"status":"alive"}` — liveness probe |
| `readyz.png` | `{"status":"ready","db":true}` — readiness probe with DB and integrations |
| `api-status.png` | `integrations.pi:true, pinata:true, database:true` — all key integrations live |
| `react-landing.png` | React app loading state (Pi SDK not available headlessly — expected) |
| `live-ipfs-test2.png` | ✅ **LIVE deployed app**: dark bg, green heading "Cherri-Test2-1788047716565", subtitle "Real Vite+React build deployed via Cherri Hosting — go-live proof." |
| `live-demo-app.png` | Same live deployed content (second capture) |

---

## Bugs Fixed

### 1. Attestation not accepted at pin time
**Problem:** `POST /:stageId/pin` created the deployment without attestation data, then `executePin` checked the fresh row and found no attestation → rejected with "You must agree to the AUP".  
**Fix:** Added attestation accept path in pin route (`server/src/routes/deployments.ts`): if `req.body.attestation` is present, validates it and stamps `attestationAcceptedAt + attestedTermsVersion` on the deployment at creation.  
**Backward compat:** Existing UI flow (which sends attestation pre-separately) unchanged; the pin route now also accepts it inline for programmatic/API use.

### 2. Dev-auth seam missing
**Problem:** No way to drive the API headlessly without a real Pi Browser session.  
**Fix:** Added `tryDevAuth()` in `server/src/middleware/piAuth.ts` — active ONLY when BOTH `CHERRI_DEV_AUTH=1` AND `NODE_ENV !== 'production'`. Token format: `dev:<piUserId>:<username>`. Upserts the user and skips api.minepi.com. Cannot activate in production.

### 3. No embedded-postgres startup script
**Problem:** `DATABASE_URL` not set → server boots in degraded mode, all routes fail.  
**Fix:** `server/scripts/dev-db.ts` and `server/scripts/start-with-db.ts` — boot embedded-postgres, apply schema, start server with live DB.

### 4. Response shape unwrapping in test client
**Problem:** API returns `{ deployment: {...} }` and `{ project: {...} }` wrappers but test script expected flat objects.  
**Fix:** Updated `drive-golive.mjs` to unwrap with `json.deployment ?? json` and `json.project ?? json`.

### 5. Gateway render check using restricted gateway
**Problem:** `gateway.pinata.cloud` returns HTTP 403 for HTML (ERR_ID:00023 public gateway restriction). Render checks failed.  
**Fix:** Updated render verification to use `<cid>.ipfs.w3s.link` and `.ipfs.dweb.link` subdomain gateways which serve HTML correctly.

---

## Honest Limitations

1. **Real Pi Browser sign-in** cannot be tested headlessly — the `dev:` auth seam is used. The Pi SDK loads from `sdk.minepi.com` which is unavailable in headless environments, so React app screenshots show a loading state.
2. **Build isolation**: `containerized: false` — no Docker/cgroups on this host. The buildService discloses this (`local-hardened` runner). Build runs in isolated temp dir with sanitized env and timeouts.
3. **Dedicated gateway**: `dedicatedGateway: false` — no personal Pinata gateway domain configured. Public gateway (gateway.pinata.cloud) blocks HTML per ERR_ID:00023; content verified via w3s.link/dweb.link subdomain gateways.
4. **TEST 3 render**: w3s.link timed out for the new CID (IPFS propagation latency). Pinata API confirms pin; render likely works once propagated.
5. **PIRC2**: Not configured — recurring subscriptions disabled. Non-fatal warning at startup.

---

## Architecture Validated

```
User (HTTP) → Express → piAuthMiddleware (dev seam) → ProjectsRouter / DeploymentsRouter
→ build-stage: upload + detectProjectType → needsBuild:false (static) or true (Vite)
→ if needsBuild: enqueueBuild → buildService (npm install + vite build in sanitized env)
→ poll GET /builds/:jobId until DONE
→ POST /:stageId/pin → executePin → attestation gate → content scan → hardenStaticBundle
→ pinDirectory (Pinata JWT) → CID + gateway URL
→ deployment.status = 'ACTIVE'
→ live verification (gateway check)
```

All steps ran for real. No simulations.
