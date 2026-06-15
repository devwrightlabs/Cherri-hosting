---
name: Multi-package repo layout (no workspaces)
description: How to install packages in this root/client/server repo (three separate package.json, no workspaces).
---

This repo has THREE separate `package.json` (root, `client/`, `server/`) and NO pnpm/npm workspaces. Each app installs its own deps and runs from its own dir (`start.sh`: `cd client && npm run dev` and `cd server && npm run dev`; `build.sh` runs `npm install` separately inside `client/` and `server/`). Root `package.json` holds only Prisma.

**Rule:** a client-only dependency must end up in `client/package.json` + `client/node_modules`; a server-only dep in `server/`.

**Why:** the package-management tool (`installLanguagePackages`) runs `npm install` at the REPO ROOT — it adds to root `package.json`/`node_modules`, NOT the sub-app. Dev may still resolve it via Node's upward `node_modules` lookup, so it looks fine locally, but the production build (`build.sh` → `cd client && npm install`) installs strictly from `client/package.json`, so a root-only dep is MISSING in the built client and breaks the build.

**How to apply:** to add a client (or server) package, run `cd client && npm install <pkg>` so it lands in that app's `package.json` + `node_modules`. If you used `installLanguagePackages` out of habit, remove the stray root entry (`npm uninstall <pkg>` at root) to keep root Prisma-only. Same root/sub-app split underlies the Prisma client sync note.
