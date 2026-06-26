---
name: Deploy page two-stage flow & CID timing
description: How the Deploy page splits into Build/Verify vs Deploy/GoLive, and why a CID cannot be shown before pinning.
---

# Deploy page: two-stage flow

The Deploy page is two visually distinct numbered cards driven by one state machine
(no global top-of-page stepper — that was intentionally removed):

- **Stage 1 "Build & Verify"**: upload/import → `buildStage` (real server build if
  needed, streamed via BuildLogPanel) → `StagePanel` shows a verification checklist
  (build ok, Pi `validation-key.txt` present, Pi SDK) + a sandboxed preview iframe.
  No pinning here. Once Stage 2 starts, Stage 1 collapses to a compact summary.
- **Stage 2 "Deploy & Go Live"**: locked until `stageResult.deployable && stageId`.
  "Deploy to IPFS" = existing `pinStaged`; then `DeployReveal`; then a `.pi` domain
  panel (DNSLink + gateway + portal + 3-state gateway verify).

## CID does not exist before pinning — never fake it
**Rule:** A real IPFS CID is only produced at **pin time** (Stage 2 / `executePin`,
surfaced on `Deployment.cid`). The stage/build phase has **no CID** — `StageResult`
deliberately carries none. Show the CID only in Stage 2 (DeployReveal / domain panel).

**Why:** Specs/requests sometimes ask to display "the CID" during build/verify. There
is nothing honest to show there; precomputing or fabricating one would mean changing
the pin pipeline or faking data — both forbidden. Pre-pin, surface a stage handle /
"Not live yet", not a CID.

**How to apply:** If asked to surface a CID earlier, push back or place it in the
post-pin reveal. The `stageId` is an opaque handle, not a CID — never label it as one.
