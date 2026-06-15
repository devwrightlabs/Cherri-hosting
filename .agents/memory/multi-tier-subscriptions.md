---
name: Multi-tier subscriptions
description: The 5-tier Pi payment system (FREE, TIER1–TIER4) and what is authoritative for entitlement.
---

## Entitlement rule (authoritative)
Tier entitlement derives from the **server-verified** Pi payment — the `amount` and payer `user_uid` returned by the Pi Platform call — NOT from anything the client sends. The client may pass an `amount`, but it is **advisory only** (logged on mismatch, never used to grant a tier). Every entitlement path (approve, complete, recovery verify) also enforces `payment.user_uid === req.user.piUserId` before granting.

**Why:** a client-supplied amount/tier let a user mint a higher tier for a smaller payment; and without an ownership check one user could activate their account from another user's payment id/txid. Both are broken-access-control bugs that were fixed — do not regress them.

**How to apply:** map the *server* amount with `resolveTierFromAmount()`; reject if it maps to no plan. Treat client `amount` as a hint only. Never add a new payment-driven grant without the `user_uid` ownership check. Completion is idempotent on `piTxId` (return the existing subscription, don't 500).

## Tier price contract (Pi/month)
FREE=0, TIER1=17, TIER2=35, TIER3=88, TIER4=125. The *displayed paid price IS the payment amount*, so any displayed price must equal the corresponding `TIERn_PRICE_PI` or `resolveTierFromAmount` rejects it. Change a price → change the constant, never just the card copy.

## UI identity mapping (master-prompt 4-tier model)
Spec marketing tiers map onto existing server keys so the amount→tier contract is untouched: **Starter→FREE, Builder→TIER1, Pro→TIER2 (35π, "Most popular", the screen's only gold), Business→TIER3 (0.5% fee, green).** TIER4 stays "Enterprise" for legacy users (not shown as a card). Spec prices (10/35/100) are illustrative.

## Other tier-gated limits
- Domain limits: FREE=1, TIER1=1, TIER2=5, TIER3/4=unlimited. Enforced when a customDomain is set.
- Upload limits enforced per tier on deployment upload.
- Legacy `PREMIUM` tier is backward-compatible — treated as TIER2 for domain/upload limits.
