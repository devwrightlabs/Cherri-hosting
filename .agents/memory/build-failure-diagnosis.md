---
name: Build failure diagnosis
description: How to turn raw build logs into a plain-English cause without mislabelling, plus pre-build project-shape gating.
---

# Build failure diagnosis + project-shape gating

Client-side `diagnoseBuildFailure(info)` converts a failed build's high-level
error + raw logs into a friendly headline/advice shown ABOVE the real log (never
replaces it). Server-side, `respondBuildOrStage` diagnoses the project's SHAPE
*before* building so doomed builds fail fast with guidance.

## Rule 1 — never match the generic npm lifecycle footer
Every failed npm build prints `npm error code ELIFECYCLE` / `npm error code 1`
in its footer, EVEN when the real cause was a TypeScript error or a missing
module. Matching that footer (or a bare `npm ERR!`) makes the diagnosis say
"Installing dependencies failed" and masks the true cause.
**How to apply:** the install-failure branch matches ONLY the engine's explicit
install phase, or real resolver/registry markers (ERESOLVE, "could not resolve
dependency", peer dep, EBADENGINE, ENOTFOUND, 404 from the registry). It must
NOT match the generic footer.

## Rule 2 — trust the engine's error field as the PHASE marker
The build engine's high-level `job.error` reliably names the phase: it starts
with "Dependency install …" for install-phase failures vs "Build …" for build
phase. Use `/dependency install/i.test(error)` to tell install from build, then
use the logs for the specific cause. This is more reliable than guessing from
log contents, which mix install + build output.
**Why:** without the phase marker, install ERESOLVE ("could not resolve
dependency") and a bundler's build-phase "Could not resolve './x'" look alike.

## Project-shape gating (pre-build, messaging only — engine untouched)
`detectMonorepo` (pnpm-workspace.yaml / root `workspaces` / ≥2 package.json) and
`detectBackendNeed` drive precedence in the not-statically-deployable branch:
(A) backend + no build script → HALT, not overridable; (B) no build script →
monorepo / unbuilt-entry / nothing-to-build message, not overridable;
(C) build script + monorepo + not acknowledged → WARN, overridable (user may
"Build anyway", which re-submits with `acknowledgeWarnings`).
**Why overridable matters:** a monorepo's root build script may still emit a
single static site, so warn but don't block. A backend with no build genuinely
has no static output, so it's a hard halt (the gated backend lane is separate).

## UI replay caveat
"Try again" replays the last submission from in-memory `File` objects. After a
RESUMED persisted build (page reloaded), those objects are gone, so the retry
handler must be withheld (gate on a `canReplay` flag) — otherwise the button is
a no-op. "Upload a different folder" always works.
