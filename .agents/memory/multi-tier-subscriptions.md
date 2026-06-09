---
name: Multi-tier subscriptions
description: How the 5-tier Pi payment system works (FREE, TIER1–TIER4).
---

## Rule
The payment `amount` (Pi) must flow from client → complete endpoint. `resolveTierFromAmount()` in `server/src/utils/constants.ts` maps amounts to tier names and storage limits.

## Why
The Pi SDK doesn't expose the payment amount in the `onReadyForServerCompletion` callback directly — the amount is captured in the outer closure of `handleUpgrade(tierKey, amount, label)` and passed to `subscriptionsApi.completePayment(paymentId, txid, amount)`.

## How to apply
- Tier prices (Pi/month): FREE=0, TIER1=17, TIER2=35, TIER3=88, TIER4=125.
- `resolveTierFromAmount(amount)` → `{ tierName, storageLimit, uploadLimit }` — also handles backward-compat PREMIUM (10π → TIER2 equivalent).
- Approval endpoint validates `amount >= TIER1_PRICE_PI` (≥17).
- Old `PREMIUM` tier in DB is backward-compatible; treated as TIER2 for domain limits and upload limits.
- Domain limits: FREE=1, TIER1=1, TIER2=5, TIER3=-1 (unlimited), TIER4=-1. Enforced server-side in PATCH /api/projects/:id when customDomain is set.
- Upload limits enforced in deployments POST via `maxUploadBytesForTier(user.tier)`.
