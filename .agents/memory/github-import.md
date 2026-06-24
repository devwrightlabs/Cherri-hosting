---
name: GitHub public-repo import
description: How Cherri Hosting ingests a public GitHub repo URL and the security boundary of running its build on a single Replit container.
---

# GitHub public-repo import

## Ingestion is fetch-only, no git binary, SSRF-closed
A public repo is imported by downloading its archive over HTTPS from GitHub's
fixed hosts — metadata from `api.github.com`, the zip from `codeload.github.com`
— with the owner/repo/ref URL-encoded into a fixed template. There is **no** git
binary and **no** user-controlled host, so the import cannot be aimed at
arbitrary/internal addresses (SSRF-closed). Ref resolution falls back
branch → tag → commit. Honest failure for: 404 (not found), private repo, and
403 rate-limit — never a faked success.

**How to apply:** the codeload zip nests everything under a single
`<repo>-<ref>/` root that the extractor must strip before staging. After
extraction the bytes go through the **same** build/stage/pin pipeline as an
upload — do not fork a second path.

## Capped streaming download (don't trust content-length)
The archive download enforces the tier byte cap by **streaming** the body and
aborting the moment the running total exceeds the cap — it does not `arrayBuffer()`
the whole body and check afterward.

**Why:** a missing or incorrect `content-length` would otherwise let an
oversized archive be fully buffered into memory before the size check runs
(memory/availability risk).

## Build isolation is a real, disclosed residual risk on Replit
The server-side build step runs the repo's own `install` + `build` scripts via
`spawn()` (shell:false, sanitized env with no secrets, temp cwd, concurrency 1,
wall-clock timeout + process-group SIGKILL, output caps). This is **not** a true
sandbox: the child runs as the **same OS user** as the app, so a malicious
build/postinstall could in principle read same-UID files or `/proc/<pid>/environ`
and exfiltrate over the network (egress is required for `npm install`).

**Why it isn't "fixed":** real isolation needs a separate container / microVM /
locked-down Unix user, none of which are available on a single Replit container
(no Docker/containerization). This tradeoff was disclosed to the user, not hidden.

**How to apply:** if true multi-tenant safety becomes required, the only correct
answer is to move builds off-box (external sandbox/CI) or gate server-side builds
to trusted/admin users — do NOT pretend env-sanitization alone makes it safe.
