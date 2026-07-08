---
name: Configure-for-Pi stage helpers
description: How pre-pin stage mutations (validation key paste, Pi SDK inject) stay race-safe and honest
---

# Configure-for-Pi stage helpers

**Rule:** Any mutation of a staged (not-yet-pinned) upload must go through a fully synchronous check-and-mutate helper (ownership + `pinning` flag checked with NO awaits before the mutation), and must recompute `totalBytes` so pin-time quota stays accurate.

**Why:** `/pin` claims the stage synchronously at entry; Node's single-threaded execution is the only atomicity guarantee. An `await` between the pinning check and the mutation would let a concurrent pin interleave and pin a half-mutated site.

**How to apply:** Use `mutateStage`-style helpers for any future stage edit; route handlers stay synchronous. A stage being pinned returns 409, an expired one 404 — never silently proceed.

Other durable decisions:
- Validation key is written as EXACT bytes (`validation-key.txt`, UTF-8, no BOM/newline); plausibility regex is deliberately lenient (one long URL-safe token) because Pi's format is unspecified — never over-validate.
- Pi SDK inject is detect-before-inject (script OR init detected anywhere ⇒ don't touch); the sandbox/env flag is the user's explicit per-injection choice about THEIR app — not gated by Cherri's mainnet enablement.
- After pinning, the stage is gone — the client is the only holder of the pasted key, so the post-deploy served-file check takes `expected` from client state; without it, report reachability only (`matches: null`), never fake a match.
- Post-deploy gateway checks reuse the 3-state honesty pattern (served / not-served / indeterminate; 429 and network errors are indeterminate, not "down").
- Stage helper UIs must bump the preview iframe key after a mutation (preview is no-store; a remount is the refresh).
