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

## Deferred — confirm before building, never fake
- Live charging cutover: at approve/complete, verify the paid Pi against the stored quote
  (amount + not expired) and grant the *dollar-plan* entitlement. Mirror the existing
  Pi-payment approve/complete pattern. Keep legacy Pi constants + `resolveTierFromAmount`
  intact during transition.
- BUILDER → internal storage/upload tier mapping is ambiguous (PRO→TIER3, TIER4→TIER4 are
  clear; BUILDER is TIER1-vs-TIER2). Resolve before granting.
- Overage (> 0) is Phase 4 metering — currently always 0, never fabricated.
- Overpayment/refund policy and app-earnings fee bps are open.
