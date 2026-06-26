---
name: Deploy build resume across navigation
description: How an in-progress server-side build survives leaving the Deploy page and reconnects on return (client-only persistence).
---

# Deploy build resume

A server-side build runs under a `jobId`; the client polls `GET /deployments/builds/:jobId`.
Leaving the Deploy page (route change, tab switch, app background / Pi Browser) used to
lose all build state and force a full re-upload+rebuild. Fix is **client-only** — persist
the jobId and reconnect, never re-run the build.

**Mechanism:** `client/src/lib/activeBuild.ts` stores `{ jobId, projectId, stage:'building',
startedAt }` in localStorage (key `cherri.activeBuild.v1`). On Deploy mount a reconnect
effect loads it, restores the project selector, shows a "Resuming…" state, and resumes
polling. The server's real status decides where it lands (building → log panel, DONE →
verified Stage 1, FAILED → real error). No build-engine/pipeline or server change was
needed — the server already retains finished jobs ~30 min (JOB_TTL_MS) and 404s when gone.

**Why no server change:** a build runs at most ~10 min and stays pollable 30 min after.
The client stale guard `ACTIVE_BUILD_MAX_AGE_MS = 60min` is a backstop only; a **404 is the
authoritative cleanup** (`isBuildGoneError` in deployApi.ts) — on 404 clear persistence,
stop polling, show an honest "no longer available" notice. Never loop a dead job.

**Lifecycle decision — persistence is KEPT on terminal states (DONE *and* FAILED), not
cleared.** So a finished-but-unpinned build or a failed build also survives navigation and
re-shows on return. It is cleared only when *consumed*: pin (`handlePin`), `resetStage`,
or `reset` (BuildLogPanel "Start over" → `reset`).
**Why:** requirement is that reconnect reflects the FINAL result, not a restart; the user
acknowledging via Start over / pin is the moment to forget it.

**How to apply:** any new exit from Stage 1 that abandons a build must call
`clearActiveBuild()`, or it will wrongly resurrect on next visit. The reconnect effect must
be declared AFTER `pollBuild`'s `useCallback` (else tsc use-before-declaration); deps
`[pollBuild]` (stable, runs once). Immediate stages (`needsBuild:false`) are NOT persisted —
there is no server job to reconnect to.
