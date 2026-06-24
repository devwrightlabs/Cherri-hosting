---
name: PiRC2 subscriptions
description: Architecture + honesty rules for the PiRC2 recurring-subscription system.
---

PiRC2 = Pi Network's on-chain recurring-subscription standard (Soroban/Stellar,
testnet-only pre-mainnet). Sherry Hosting implements the full subscription
lifecycle behind a single adapter so it can switch on when chain config exists.

**Verified status (June 2026, from official Pi docs/PiRC2 repo):** Pi's
subscription smart contract is Pi's *first* smart-contract capability and is
LIVE ON TESTNET ONLY — still in PiRC2 "Request for Comment" + external audit
review, NOT yet on Mainnet. Current Pi SDK v2 has NO native recurring/auto-renew;
ordinary U2A payments require user approval every charge. The contract's
innovation: subscriber approves a budget + billing horizon ONCE (no re-sign per
cycle); funds stay in the wallet and are pulled only when each charge comes due
if balance suffices. **Implication:** real auto-renew CANNOT run on Mainnet today
— so Phase 8 auto-renew must stay inert/gated and honest; only Testnet can
exercise it. Re-verify mainnet availability before enabling for real billing.

**Honesty rule (non-negotiable):** the adapter NEVER fabricates a charge. When
PiRC2 config is absent, on-chain ops throw `IntegrationUnavailableError` →
routes return 503; the scheduler skips (does not penalise users). Access to
PREMIUM is granted ONLY as a consequence of a real successful charge.

**Config gates (`isPirc2Configured`):** PIRC2_CONTRACT_ID + SOROBAN_RPC_URL +
PIRC2_NETWORK_PASSPHRASE. Mutating draws additionally require
PIRC2_MERCHANT_SECRET (signer). `verifyAllowanceApproval` is real (Soroban RPC
`getTransaction`) when configured and fail-closed.

**Contract-native BATCH model (the key correctness rule):** the contract bills
via a MERCHANT-authed `process(merchant, service_id, offset, limit)` that draws a
*page of subscribers at once* and emits per-subscriber events: `charge`
(subscriber,service_id,price) and `chg_fail` (subscriber,service_id,sub_id).
Insufficient funds is a `chg_fail` EVENT, not a tx failure. So you must reconcile
each local row by MATCHING ITS subscriberAddress against the decoded events —
NEVER trust the aggregate ProcessResult counts as per-user proof (a count of "1
charged" does not tell you WHICH subscriber). `subscribe` is SUBSCRIBER-authed;
the merchant CANNOT revoke/cancel → `revokeAllowance` is an honest no-op (local
stop only; on-chain allowance lapses at its horizon or the subscriber cancels).

**Lifecycle:** subscribe verifies the one-time allowance approval on-chain
(fail-closed: must succeed + invoke configured contract's `subscribe` + author =
expected subscriber; service_id/sub_id decoded from THAT tx, never a client
hint) and creates an ACTIVE sub with `nextBillingAt=now`, `cyclesBilled=0`, no
access yet. The billing scheduler groups due rows by `onChainServiceId`, claims a
window, pages `process()` once per service, and reconciles each row from events:
charge → advance period/allowance + grant; chg_fail → PAST_DUE + revoke; no event
for a due row → release claim + back off. Horizon + expiry preserved.

**Why grant-after-charge:** prevents free PREMIUM in the partial-config state
(RPC present, signer absent) where draws keep failing.

**Decode authority:** decode contract events with the SDK's own
`humanizeEvents` (stellar-base, re-exported by stellar-sdk) — it gives the `C...`
contractId strkey via `StrKey.encodeContract(event.contractId())` plus
`scValToNative` topics/data. `ContractEvent.contractId()` is an xdr.Hash (NOT an
ScAddress) — `Address.fromScAddress` on it is WRONG. Don't hand-roll the XDR walk.

**Testnet-only guard is FAIL-CLOSED (`assertDrawNetworkAllowed`):** a draw runs
only if the network passphrase is on a testnet ALLOWLIST (builtin: "Pi Testnet",
"Test SDF Network ; September 2015"; extend via PIRC2_ALLOWED_PASSPHRASES) AND
not on the mainnet denylist (builtin: Stellar public + "Pi Network"; denylist
wins) AND SOROBAN_RPC_URL is https. Unknown/empty passphrase ⇒ refused. **Why:** a
denylist alone lets an unknown production passphrase slip through; PiRC2 has no
mainnet contract so default-deny is the only safe stance.

**Pre-enablement follow-ups (MUST address before enabling real draws on testnet
— not yet done, feature stays gated):**
- *Crash idempotency:* if `process()` tx succeeds but the node dies before the
  per-row DB reconcile commits, the next tick's `process()` SKIPS that already-
  charged subscriber (no new event) so they're charged on-chain but never
  granted. Errs safe (under-grants, never fakes) but needs durable
  process-tx/event persistence + replay, or an on-chain per-sub state read, to
  recover. Don't "fix" by granting on a bare is_subscription_active read —
  active≠charged-this-cycle.
- *Wallet ownership binding:* `/subscribe` proves the subscribe tx's subscriber
  matches the client-supplied subscriberAddress, but does NOT bind that address
  to the authenticated Pi user. A user could claim someone else's public
  subscribe tx (approvalTxId @unique only blocks double-binding the SAME tx).
  Needs a wallet challenge-response / Pi-user↔address proof before opening.
