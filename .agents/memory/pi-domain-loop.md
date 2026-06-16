---
name: Pi (.pi) domain loop
description: Why the .pi domain → hosted-site connection cannot be auto-wired, and the honest UX that replaces faking it.
---

## Constraint
A third-party app **cannot** automate the `.pi` domain → content connection. Pi Network controls `.pi` resolution and the domain's certificate through its own domain portal (PiNet, `domains.pinet.com`). There is no confirmed public Pi developer API to verify domain ownership or set a domain's resolution target programmatically. Treat full auto-connect as NEEDS APPROVAL pending real Pi docs/API — do not build it on assumptions.

**Why:** the master prompt's honesty rule forbids implying success that didn't happen. Storing a domain string and reporting it "mapped/connected" is a lie, since saving connects nothing.

## How to apply (the honest flow)
What Sherry legitimately provides: site files pinned to IPFS → a CID + an HTTPS gateway URL, already served over HTTPS by the gateway. The user then points their `.pi` domain at that address **manually in Pi's portal**. Guide, don't fake: win domain at auction → copy the deployment's gateway URL / CID → set it as the target in Pi's portal.
- The stored `customDomain` is a dashboard label only; never word it as "connected/mapped/live."
- Don't claim Pi-side behavior you can't verify (exact portal steps, `.pi` cert mechanics) — attribute resolution/certs to Pi Network.
- **Pi Browser nav quirk:** open Pi ecosystem pages via `window.open(url, '_blank')` — this triggers Pi Browser's native deep-link / app-switch behaviour and preserves the auth session. Do NOT use `window.location.href` for external pinet/Pi ecosystem URLs: it navigates the dApp frame itself, stripping Pi Auth headers and causing "An unexpected error occurred while authenticating."
