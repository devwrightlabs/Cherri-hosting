---
name: Multi-tier subscriptions
description: The 5-tier Pi payment system (FREE, TIER1–TIER4) and what is authoritative for entitlement.
---

## Entitlement rule (authoritative)
Tier entitlement derives from the **server-verified** Pi payment — the `amount` and payer `user_uid` returned by the Pi Platform call — NOT from anything the client sends. The client may pass an `amount`, but it is **advisory only** (logged on mismatch, never used to grant a tier). Every entitlement path (approve, complete, recovery verify) also enforces `payment.user_uid === req.user.piUserId` before granting.

**Why:** a client-supplied amount/tier let a user mint a higher tier for a smaller payment; and without an ownership check one user could activate their account from another user's payment id/txid. Both are broken-access-control bugs that were fixed — do not regress them.

**How to apply:** map the *server* amount with `resolveTierFromAmount()`; reject if it maps to no plan. Treat client `amount` as a hint only. Never add a new payment-driven grant without the `user_uid` ownership check. Completion is idempotent on `piTxId` (return the existing subscription, don't 500).

## Tier price contract (Pi/month)
Prices are sold from `TIERn_PRICE_PI` constants (mirrored client+server — change both in lockstep, never just card copy). The *displayed paid price IS the payment amount*, so any displayed price must equal a value `resolveTierFromAmount` accepts or it rejects. Annual = monthly × `ANNUAL_MULTIPLIER` (10 = two months free); the annual amount shown is exactly what `createPayment` charges, and the server returns `months` (1 or 12) for `periodEnd`.

## resolveTierFromAmount design (do not regress)
It is **exact-match** (epsilon 1e-6) over price tables, NOT a `>=` cascade. **Why:** a `>=` cascade mis-maps a valid higher amount (e.g. an annual 260π) onto a higher tier, and lets any over/under amount slip into a tier. Two separate tables: CURRENT (current monthly + annual) is always accepted; LEGACY (pre-rollout amounts) is accepted **only** when the caller passes `{ allowLegacy: true }`.

**Underpayment exploit (fixed, do not reopen):** never put old/legacy prices in the always-accepted table — a tampered client would keep buying paid tiers at the old amount forever. Legacy is honored ONLY for grandfathering an *old in-flight* Pi payment, gated by `payment.created_at < PRICING_V2_CUTOFF`. If Pi omits `created_at`, default to allowLegacy=false (deny = safe). New purchases (approve + normal complete) are current-only.

## Never developer-complete a payment you can't honor
On any path that calls `completePayment`, resolve the entitlement from the **server-fetched** payment amount BEFORE completing, and 400 if it maps to no plan. **Why:** completing first then rejecting an unmappable/legacy amount means the user paid and got nothing. The complete path uses the same `created_at < cutoff` legacy gate as recovery so old in-flight payments are grandfathered. After completing, assert `completed.amount === pre.amount` (entitlement still derives from the server amount; client `amount` stays advisory).

## UI identity mapping
Stable server keys keep the amount→tier contract fixed regardless of marketing copy: **Starter→FREE, Builder→TIER1, Pro→TIER2 (the Pricing screen's only gold zone), Business→TIER3 (0.5% fee, green).** TIER4 stays "Enterprise" for legacy users (not shown as a card; recovery/grandfather only).

## Other tier-gated limits
- Domain limits: FREE=1, TIER1=1, TIER2=5, TIER3/4=unlimited. Enforced when a customDomain is set.
- Upload limits enforced per tier on deployment upload.
- Legacy `PREMIUM` tier is backward-compatible — treated as TIER2 for domain/upload limits.
