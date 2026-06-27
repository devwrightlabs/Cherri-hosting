---
name: Dollar-pegged Pi billing foundation
description: WOODSTICK 3 Phase 5 — quote-based USD-anchored Pi pricing; honesty + math + SSRF rules and deferred live-charging cutover.
---

# Dollar-pegged Pi billing (quote foundation)

Plans are anchored in USD (FREE $0 / BUILDER $35 / PRO $143 / TIER4 $350; every paid
price's digits sum to 8). At checkout we convert USD → Pi using a LIVE rate and a
billing buffer. This slice only **quotes**; it never charges or grants entitlements.

## Honesty rules (do not regress)
- **Never fabricate a price or its freshness.** The price provider must return both a
  positive `usd` and a usable source timestamp; if either is missing/invalid, throw and
  surface an honest **503** (`IntegrationUnavailableError('pi-price')`). Never substitute
  `new Date()` for the source's `last_updated_at`, and never fall back to a cached/guessed
  rate. Stale (> ~1h) is rejected too.
- **Never undercharge on rounding.** Compute owed stroops as an integer-exact numerator
  divided by the live rate, then **ceil**: `ceil( usdCents * (10000 + bufferBps) * 10 / piUsd )`,
  then `/1e7`. The numerator is exact for integer inputs so the only float op is the single
  division; ceil means worst case is +1 stroop (overcharge), never a stroop short.
  **Why:** a naive `ceil(raw*1e7 - epsilon)` rounds DOWN by a stroop, and `1.04` is not
  float-exact so plain `ceil(raw*1e7)` overcharges on clean cases — the integer-numerator
  form avoids both.
- Underpayment (> 1 stroop short) is never "ok"; overpayment is flagged separately and
  must never auto-grant.

## Security
- Price source is chosen by an **allowlisted provider KEY**, mapped internally to a fixed
  URL — never a user/env-supplied URL. **Why:** prevents SSRF via the price-source config.

## Decisions captured from the user
- Price source = **CoinGecko** (`PI_PRICE_SOURCE=coingecko`, shared non-secret env). Coin id
  is `pi-network`; endpoint is `simple/price?ids=pi-network&vs_currencies=usd&include_last_updated_at=true`,
  shape `{"pi-network":{"usd":NUM,"last_updated_at":TS}}`.
- Pricing model = **REPLACE** the old Pi-amount tiers — BUT grandfather active subscribers
  until their renewal; never retroactively revoke a mid-period subscription.

## Live-charging cutover — SHIPPED (end-to-end wiring)
The approve/complete flow is now **dual-path**, keyed on whether the Pi payment's
metadata carries a `quoteId`:
- **Pegged path (`quoteId` present):** metadata is a LOCATOR only. The granted plan
  comes from `quote.plan` (→ `PLAN_ENTITLEMENT_TIER`), NEVER from client metadata; the
  optional `catalogKey`/`plan`/`tier` fields are only a cross-check. Amount is validated
  by **exact stroop equality** against the stored quote (no percentage tolerance — a
  percentage band is a discount exploit).
- **Legacy path (no `quoteId`):** untouched — `resolveTierFromAmount` over the fixed
  Pi-amount table, grandfathered before the v2 cutoff. Do not modify this branch.
- **Approval** atomically binds the quote to the payment via
  `updateMany({ where:{ id, paymentId: null }})` — replay/race guard; a 0-row update where
  the existing binding ≠ this payment ⇒ 409.
- **Completion** re-validates the AUTHORITATIVE `completed.amount` (from Pi, not client)
  against the quote, then grants entitlement + marks the quote `PAID` in **one
  `$transaction`** (no charged-but-unhonoured / double-grant window).
- The Pi SDK handshake (`Pi.createPayment` → approve → complete, testnet/sandbox) is
  mechanically **identical** to legacy; only the `amount` (a live quote) and `metadata`
  (the `quoteId`) differ.

### Gotcha — idempotency must run BEFORE quote-status resolution (retry 409 bug)
Pi **retries** the completion callback. On the retry the bound quote is already `PAID`,
so calling `resolvePeggedPayment` first returns 409 (`quote.status !== 'PENDING'`) and the
legitimate retry fails. **The `findUnique({ piTxId })` idempotency check must be the FIRST
thing in the pegged completion branch**, before any quote-status check — return the existing
subscription. (Legacy path keeps its own idempotency check after completing; don't add a
shared top-level one — it collides with the legacy `const existing` declaration.)

## Resolved decisions
- BUILDER→TIER1, PRO→TIER2, **TIER4 (the $350 catalog key) → TIER3** (50 GB "Business").
  The $350 plan is keyed `TIER4` historically but grants the **TIER3** entitlement, Cherri's
  top sold tier — NOT legacy 100 GB TIER4. Map lives in `PLAN_ENTITLEMENT_TIER`.
- Public `GET /api/billing/pricing` is display-only, registered BEFORE `piAuthMiddleware`
  (reachable pre-auth for the pricing page); honest 503, never a fabricated price.
- Client pricing page: USD anchor renders instantly from local config; live Pi headline is
  non-blocking (8 s timeout → "≈ updating…" / "≈ Pi price updating" fallback, never an
  infinite spinner). `/quote` `quotedPiAmount` is a Prisma Decimal **string** — `Number()`
  it before math; `/pricing` returns numbers.

## Still deferred — confirm before building, never fake
- Overage (> 0) is Phase 4 metering — currently always 0, never fabricated.
- Overpayment/refund policy and app-earnings fee bps are open.
- `UpgradeBanner.tsx` (PREMIUM, 10π, no `quoteId`) intentionally left on the legacy path.
