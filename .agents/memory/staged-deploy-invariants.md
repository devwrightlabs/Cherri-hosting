---
name: Staged deploy honesty + secret invariants
description: Cross-cutting rules for the upload→stage→preview→pin deploy pipeline that are easy to violate when adding a new ingestion path.
---

# Staged deploy: honesty + secret invariants

## Rule 1 — every upload ingestion path MUST drop secret/ignored files before staging or pinning
Any code that turns a raw upload into deployable files must run `shouldIgnoreFile()`
on each path and exclude matches (`.env*`, private keys/`.pem`/`.key`, `node_modules`,
`.ssh`/`.aws`, etc.). This applies to ZIP extraction, folder/multi-file assembly, AND
the lone single-file case.

**Why:** staged files are served by a PUBLIC preview route, reachable by anyone who has
the (unguessable, short-TTL) stage URL — and pinned files go to public IPFS, which is
irreversible. A gap here leaks credentials. An architect review caught the legacy
non-ZIP folder path still pinning `.env` after the staged path was already fixed.

**How to apply:** when you add or change any upload route / assembly helper, filter with
`shouldIgnoreFile` at the point paths are known, before files reach the staging store or
`executePin`. A lone ignored file should yield an empty deployable set that the route
rejects with 400, never a pin.

## Rule 2 — never pin an app we know is unbuilt (no fake builds)
`resolveDeployable()` trusts entries from build-output dirs (`dist/ build/ out/ _site/`)
but content-scans any other chosen entry HTML for unbuilt markers (`<script src=".../src/...">`,
`*.tsx/.ts/.jsx`, `%PUBLIC_URL%`, `%VITE_*%`). On a match it returns `deployable:false`
with build guidance instead of pinning.

**Why:** MASTER RULE — never fake build success. Pinning a Vite/CRA template that loads
source modules a browser can't run would ship a broken site dressed up as a success.

**How to apply:** keep the scan `<script>`-scoped so a static site that merely references
`/src/` from an `<img>`/`<link>` is not false-flagged. Build output is trusted; everything
else is scanned.

## Rule 3 — pin is claimed atomically per stage
`/:stageId/pin` uses `claimStage()` (check-and-set `pinning`, atomic under Node's single
thread): 409 if already pinning, delete-on-success, release-on-failure and on every
pre-launch early return so a failed pin can be retried.

**Why:** without the lock, a double-click / concurrent retry creates multiple deployments
from one upload before `storageUsed` increments — double-pin + quota bypass.
