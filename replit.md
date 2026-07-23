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
