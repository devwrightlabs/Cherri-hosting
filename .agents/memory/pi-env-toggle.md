---
name: Pi env toggle (testnet/mainnet)
description: How TEST|LIVE environment switching works and the honesty rules that gate mainnet.
---

## Decision
The Pi environment (`testnet`|`mainnet`) is a standalone reactive store (`client/src/lib/piEnv.ts`, `useSyncExternalStore` + localStorage), NOT part of AuthProvider/PiSDKProvider. `getEnv()` is readable synchronously so the SDK init path can use `sandbox: sandboxFor(getEnv())`. Switching env re-inits the Pi SDK then re-authenticates (calls `signIn()` directly, no `signOut()` — that would double-fire the auto-sign-in effect).

**Why:** the SDK `sandbox` flag must be decided before/independently of React auth state, and a switch must deterministically re-init then re-auth. Keeping env outside the providers avoids init/auth ordering races.

## Honesty gating (critical — never fake real Pi)
- Mainnet is real only when `VITE_PI_MAINNET_ENABLED=true` (client) AND `PI_API_KEY_MAINNET` exists (server). Today only a testnet key exists, so LIVE is gated.
- Client: when mainnet is disabled, the app refuses to boot into OR switch to mainnet (`readInitial` + `setEnv` both force/refuse), regardless of stale localStorage / `VITE_PI_ENV`.
- Server: `serverKeyFor('mainnet')` has NO testnet fallback — a mainnet call without the mainnet key returns an honest 503 (`IntegrationUnavailableError`), never silently charges with a sandbox key. `serverKeyFor('testnet')` falls back to legacy `PI_API_KEY`.
- `env` is threaded through every Pi API call + `createPayment` metadata, persisted on `Subscription.env`, and cross-checked (request env must equal `metadata.env`) on complete/verify.

**How to apply:** any new Pi-money flow (e.g. domain purchases, A2U revenue splits) must thread `env`, gate mainnet behind BOTH flags, and degrade with an honest 503 rather than faking success.
