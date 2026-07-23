---
name: Live-link verification
description: Post-pin body-sniff verification of the live IPFS URL; honest VERIFIED/INDETERMINATE/FAILED states and client polling contract.
---

# Live-link verification (post-pin)

Rule: after a successful pin, the server body-sniffs the derived live URL and
persists `liveCheckStatus` (VERIFIED / INDETERMINATE / FAILED) + detail on the
deployment row. A verification error must NEVER fail an otherwise successful
deployment (wrapped in try/catch inside executePin).

**Why:** the public Pinata gateway blocks website HTML (ERR_ID:00023), so a
"successful" deploy could still white-screen. Celebrating an unverified link
violates the project's core honesty principle.

**How to apply:**
- Live URLs are derived at read time (`withLiveUrl`) from CID + entryPath,
  preferring `PINATA_DEDICATED_GATEWAY`; the stored gateway column is legacy.
  Every deployment read path must map through `withLiveUrl`.
- Classification is 3-state: HTTP 429/5xx/timeouts ⇒ INDETERMINATE (unknown ≠
  down); ERR_ID:00023 block page / directory listing / non-HTML ⇒ FAILED with
  the real reason. Keep block-page string matches Pinata-specific — a user
  site containing "content blocked" must not be marked FAILED.
- Client contract: EVERY reveal surface (Deploy page AND dashboard QuickDeploy)
  must keep polling a bounded number of ticks past ACTIVE while
  liveCheckStatus is UNCHECKED, and the UNCHECKED spinner must always have a
  "Check now" escape hatch (POST /:id/verify-live). "Your site is live" copy
  only on VERIFIED.
- Lesson: when adding post-terminal polling behavior, sweep ALL components
  that poll deployments — QuickDeploy was initially missed and froze on the
  spinner (caught in review).
