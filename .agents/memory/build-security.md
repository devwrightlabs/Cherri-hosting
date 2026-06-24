---
name: Build security (untrusted user code)
description: How Cherri runs strangers' code at build time, the dependency policy, and the residual risk that cannot be removed on this host.
---

# Build security — running strangers' code

Cherri builds (and the future backend lane runs) **untrusted user code**. The
build host is Replit/NixOS with **no Docker / cgroups / root**, so true container
isolation is impossible here. The builder is a **hardened local runner**, NOT a
container — never claim otherwise. `getBuildIsolation()` reports
`containerized:false` and is surfaced per-build via `job.security` + the
`/builds/:jobId` poll route. Honesty over fake isolation.

## Dependency policy (env `BUILD_DEPENDENCY_POLICY`, default BALANCED)
- strict / balanced → install runs with `--ignore-scripts` (CLI flag beats a
  project `.npmrc`); permissive → scripts run, suspicious ones flagged.
- BALANCED additionally **rebuilds** native packages so real apps still work —
  but ONLY when their identity is proven.

## The non-obvious rule: provenance comes from the LOCKFILE, not package.json
**Why:** a "vetted allowlist" of native packages (esbuild, sharp, @swc/core, …)
is only meaningful because on the **public npm registry a name is globally
unique** — so a registry-sourced `esbuild` genuinely IS the vetted package. The
ONLY way to smuggle attacker code under an allowlisted name is to redirect that
name to a non-registry source (file:/link:/git/url/`npm:` alias/override) or pin
a malicious tarball in the lockfile.

**How to apply:** before re-running an allowlisted package's lifecycle scripts
(`npm rebuild`), prove every installed copy resolves from
`https://registry.npmjs.org/` with integrity and is not a link, by parsing the
post-install `package-lock.json` (`proveRegistryFromNpmLock`). Root
package.json specs are NOT provenance — they miss lockfile-pinned tarballs and
transitive/hoisted fake copies. Also require the installed `.name === name` and
that the root hasn't redirected it. pnpm/yarn rebuilds are **disabled** (their
lockfiles aren't verified yet) — skip + log honestly, never guess. Any future
change to the rebuild path MUST keep lockfile-based proof or it reopens a hole.

## Residual risk (cannot be removed on this host)
The user's own `build` script still runs arbitrary code under the same
hardened-but-not-containerized envelope (sanitized throwaway env+HOME, 0700 temp
dirs, wall-clock timeout with process-group SIGKILL, best-effort ulimit -t/-f,
output caps, single-build queue). RSS/CPU are NOT hard-capped (no cgroups). True
isolation belongs in the **gated ephemeral remote build container** seam
(`describeRemoteBuilder()`), which stays blocked behind paid Railway provisioning
+ a build-container template. Do not expand the allowlist casually.

## Per-app DB credential isolation
`assertPerAppDbIsolation()` (provisioningService) enforces that a user backend's
`DATABASE_URL` is a Railway var ref `${{<svc>.DATABASE_URL}}` to its OWN Postgres
— never a literal connection string and never Cherri's master `DATABASE_URL`.
