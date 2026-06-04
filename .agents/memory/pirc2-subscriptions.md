---
name: PiRC2 subscriptions
description: Architecture + honesty rules for the PiRC2 recurring-subscription system.
---

PiRC2 = Pi Network's on-chain recurring-subscription standard (Soroban/Stellar,
testnet-only pre-mainnet). Sherry Hosting implements the full subscription
lifecycle behind a single adapter so it can switch on when chain config exists.

**Honesty rule (non-negotiable):** the adapter NEVER fabricates a charge. When
PiRC2 config is absent, on-chain ops throw `IntegrationUnavailableError` →
routes return 503; the scheduler skips (does not penalise users). Access to
PREMIUM is granted ONLY as a consequence of a real successful charge.

**Config gates (`isPirc2Configured`):** PIRC2_CONTRACT_ID + SOROBAN_RPC_URL +
PIRC2_NETWORK_PASSPHRASE. Mutating draws additionally require
PIRC2_MERCHANT_SECRET (signer). `verifyAllowanceApproval` is real (Soroban RPC
`getTransaction`) when configured; `chargeCycle`/`revokeAllowance` are the
activation seam that still need the contract client wired for the target
network.

**Lifecycle:** subscribe verifies the one-time allowance approval on-chain and
creates an ACTIVE sub with `nextBillingAt=now`, `cyclesBilled=0`, no access yet.
The billing scheduler (interval tick, singleton, `BILLING_TICK_MS` default 60s)
draws each cycle → on success advances period/allowance + grants access; on
`InsufficientFundsError` → PAST_DUE + revoke access; at horizon
(`cyclesBilled>=cyclesAuthorized`) stops billing then EXPIRES when period ends.
Cancel = best-effort revoke + CANCELLED + immediate access revoke.

**Why grant-after-charge:** prevents free PREMIUM in the partial-config state
(RPC present, signer absent) where draws keep failing.
