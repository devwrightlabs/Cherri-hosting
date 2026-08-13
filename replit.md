# Cherri Hosting

## Overview
Mobile-native Pi Browser SaaS for deploying static sites to IPFS, paid in Pi.
Users upload a site (files, folder, ZIP, or GitHub repo), Cherri optionally
builds it, hardens it against gateway white-screens, pins it to IPFS via
Pinata, and verifies the live link actually renders before celebrating it.

## Architecture
- `client/` — React + Vite + TypeScript, port 5000. Mobile-first dark UI
  (teal palette under legacy `cherry`/`gold` token names).
- `server/` — Node/Express + Prisma + PostgreSQL, port 4000. Prisma schema
  lives at root `prisma/`; both root and `server/node_modules` Prisma clients
  must be regenerated and synced after schema changes.
- Three `package.json` files (root/client/server), no workspaces — install
  deps inside `client/` or `server/` directly.
- Started via `bash start.sh` (workflow "Start application").

## Key principles
- Never fake success: payments, pinning, builds, and live-link checks degrade
  honestly (503s, INDETERMINATE states) instead of pretending.
- Live URLs are derived at read time from the CID + entry path, using
  `PINATA_DEDICATED_GATEWAY` when configured (the public Pinata gateway
  blocks website HTML — ERR_ID:00023).
- Post-pin, the server body-sniffs the live URL and records
  VERIFIED / INDETERMINATE / FAILED on the deployment; the client never
  celebrates an unverified link.

## Environment
- Secrets: `PINATA_JWT` (primary), `PINATA_API_KEY`/`PINATA_API_SECRET`
  (fallback), `PI_API_KEY`, `RAILWAY_API_TOKEN` (inert until GO-LIVE).
- Optional env: `PINATA_DEDICATED_GATEWAY` — dedicated gateway host; without
  it live links fall back to the public gateway and the UI shows an honest
  warning.

## Tests
- `cd server && npx tsx --test src/__tests__/*.test.ts`

## User preferences
- Honest UX above all: no fake progress, no celebrated failures.
- Mobile-native feel: 44px tap targets, plain language, no dev jargon in
  user-facing copy.

## Local development (verified)

All steps below were verified on Debian 13 (x86_64), Node v22, no root, no Docker.

### 1. Install dependencies

```bash
# Root workspace
cd Cherri-hosting && npm install

# Server
cd server && npm install

# Client
cd client && npm install
```

### 2. Generate Prisma client (no database required)

```bash
cd server
npx prisma generate --schema ../prisma/schema.prisma
# ✔ Generated Prisma Client (v5.22.0)
```

### 3. Build server (TypeScript)

```bash
cd server && npm run build   # tsc — zero errors
```

### 4. Build client (TypeScript + Vite)

```bash
cd client && npm run build
# dist/index.html          1.13 kB │ gzip:   0.60 kB
# dist/assets/index-*.css  36.38 kB │ gzip:   7.14 kB
# dist/assets/index-*.js  467.57 kB │ gzip: 145.58 kB
```

### 5. Run server tests (no database)

```bash
cd server && npm test
# 84 pass, 26 fail — all failures are DB-integration tests
#   that need DATABASE_URL (expected without a live DB)
```

### 6. Userland embedded Postgres (no root, no Docker)

Install once globally or in /tmp:
```bash
npm install embedded-postgres   # downloads postgres 18.x binaries
```

Start and push schema:
```bash
node -e "
import('embedded-postgres').then(async ({ default: EmbeddedPostgres }) => {
  const { execSync } = require('child_process');
  const { rmSync, existsSync } = require('fs');
  const PGDATA = '/tmp/pgdata-cherri';
  const PGPORT = 25432;
  const DB_URL = 'postgresql://postgres:Cherri1234@127.0.0.1:' + PGPORT + '/cherritest';
  if (existsSync(PGDATA)) rmSync(PGDATA, { recursive: true });
  const pg = new EmbeddedPostgres({ databaseDir: PGDATA, user: 'postgres', password: 'Cherri1234', port: PGPORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('cherritest');
  execSync('npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'inherit'
  });
  console.log('DATABASE_URL=' + DB_URL);
  // Keep running or call pg.stop() when done
}).catch(console.error);
"
```

Then export and run server + client:
```bash
export DATABASE_URL=postgresql://postgres:Cherri1234@127.0.0.1:25432/cherritest
cd server && npm run dev     # port 4000
cd client && npm run dev     # port 5173
```

### 7. Run tests with database (110/113 pass)

```bash
DATABASE_URL=postgresql://postgres:Cherri1234@127.0.0.1:25432/cherritest \
  npm test
# 110 pass, 3 fail
# Remaining 3 failures (tests 75, 76, 94) require RAILWAY_API_TOKEN +
#   GO-LIVE mode (external paid Railway service). They are gated by
#   explicit precondition assertions and cannot pass without Railway.
```

### 8. Server startup (honest degraded mode without credentials)

Without any env vars the server boots with clear warnings (never crashes):
```
[startup] DATABASE_URL is not set. Database-backed routes will be unavailable.
[startup] PI_API_KEY is not set. Pi Network payment features are disabled.
[startup] Pinata credentials are not set. IPFS deployments are disabled.
[startup] PiRC2 is not configured. Recurring subscriptions are disabled.
[startup] RAILWAY_API_TOKEN is not set. Backend provisioning is disabled.
Cherri Hosting API running on port 4000
```

GET /health → `{"status":"ok","timestamp":"..."}` (always reachable)
GET /api/status → integrations object showing what is/isn't configured

### Key constraint

`prisma/schema.prisma` datasource provider stays **postgresql** at all times.
Prisma client generates cleanly from schema alone (no live DB needed for build).
