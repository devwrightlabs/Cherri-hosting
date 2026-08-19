# Cherri Hosting — Stage 1 Build Tickets (zero→one)

> Executable backlog for the static-hosting-done-right release. Ordered by dependency.
> Every ticket is DONE only when its acceptance criteria pass **by execution** (build/boot/
> drive the real app), never by claim. One repo per sub-agent. L3 = human/signed approval
> required (merge main, DB migrations, deploy, mutative domains/payments).
>
> Critical path: **E0 → E1 → E2 → (E3 ∥ E4 ∥ E5) → E6**

Legend — Size: S(<½day) M(~1day) L(multi-day) · Gate: L1 auto / L2 CI-PR / L3 approval

---

## EPIC 0 — Real credentials & config  *(unblocks everything; needs Brenden inputs)*

- **T0.1 Pinata real pinning** · S · L2 · *blocked: Pinata JWT*
  Wire JWT into pin service; pin a real folder end-to-end; verify CID renders via gateway.
  ✅ Accept: upload sample → CID returned → live gateway URL HTTP 200 renders the site.

- **T0.2 Pi live auth + payment verify** · M · L3 · *blocked: Pi Portal app key+secret*
  Server-side verification of Sign in with Pi + approve/complete payment callbacks.
  ✅ Accept: real Pi Browser sign-in issues session; a test Pi payment approves+completes server-side (idempotent).

- **T0.3 Railway project + token** · S · L3 · *blocked: Railway token*
  Create Railway project; store token in hPanel env; health-check API reachable from server.
  ✅ Accept: server can create + destroy a throwaway Railway service via API.

---

## EPIC 1 — Railway build isolation  *(the core flip; the spine of Stage 1)*

- **T1.1 Remote builder impl behind `describeRemoteBuilder`** · L · L2
  Ephemeral Railway build container: push source → run install+build with existing
  `buildSecurity` policy INSIDE the container → stream real logs → collect output → destroy.
  Keep the exact builder interface so UX/preview/pin path is reused unchanged.
  ✅ Accept: known repo builds in an isolated container; logs stream live; Cherri secrets
  absent from build env (assert); container destroyed after; output handed to finalizer.

- **T1.2 Build-time egress policy** · M · L2
  Allow package registries + git; block/monitor arbitrary outbound (anti-exfil/miner).
  ✅ Accept: install succeeds; a test build attempting outbound to a random host is denied+logged.

- **T1.3 Route + fallback flip** · S · L2
  Route to remote builder when Railway configured; honest in-process fallback when not.
  Unblocks the 3 gated tests.
  ✅ Accept: 113/113 green with Railway configured; graceful honest degrade without it.

---

## EPIC 2 — Content safety & takedown  *(protect the Pi ecosystem — core worry)*

- **T2.1 AUP + per-deploy attestation** · S · L2 ✅ **DONE (pre-stage)**
  docs/ACCEPTABLE-USE-POLICY.md written (v1.0.0); CURRENT_AUP_VERSION constant; Deployment.attestationAcceptedAt/attestedTermsVersion fields added; migration SQL written (prod apply = L3-pending); requireAttestation gate wired into executePin (single pre-pin choke point); 15/15 tests passing.
  ✅ Accept: deploy without attestation is refused.

- **T2.2 Pre-publish scanner** · L · L2 ✅ **DONE (pre-stage)**
  services/safety/contentScanner.ts: CLEAN/SUSPICIOUS/BLOCKED verdicts; checks malware sigs, phishing/credential-harvest forms, obfuscated JS, crypto/wallet-drainer sigs; pluggable UrlReputationProvider seam (local heuristic default); wired into executePin after attestation gate; 11/11 tests with benign/phishing/wallet-drainer/obfuscated fixtures.
  ✅ Accept: benign site passes; phishing fixture flagged; wallet-drainer BLOCKED (never pinned).

- **T2.3 Operator review lane** · M · L3
  Flagged deploys route to `operatorGoLive`; human approve/reject before live.
  ✅ Accept: flagged deploy sits PENDING_REVIEW; operator approve→live, reject→discarded+user notified.

- **T2.4 Takedown / unpin kill-switch** · M · L3
  Operator action: unpin from Pinata + drop gateway/domain mapping + mark TAKEN_DOWN + notify.
  ✅ Accept: live site → takedown → gateway 404/removed, deployment TAKEN_DOWN, user notified.

- **T2.5 Ban-identity cascade** · S · L3
  Ban a Pi identity → all their live deploys taken down + future deploys blocked.
  ✅ Accept: banned identity's sites go down; new deploy attempt refused.

---

## EPIC 3 — Domains / DNS / SSL  *(Hostinger-wrapped + Pi-native)*

- **T3.1 DomainProvider abstraction** · S · L2 ✅ **DONE (pre-stage)**
  services/domain/DomainProvider.ts (interface + types); PiDomainProvider (Pi inventory + CID mapping, works without keys); HostingerDomainProvider (typed Hostinger seam, NOT_CONFIGURED gate + real call shapes stubbed+commented for T3.2); domainProviderFor() selector; 25/25 tests.
  ✅ Accept: interface unit-tested with both providers; Pi works; Hostinger gates honestly.

- **T3.2 Hostinger provider (web2 bridge)** · L · L3
  Wrap Hostinger domains/DNS/SSL API: connect real domain, edit records, auto-SSL+renew.
  ✅ Accept: connect a real test domain via Hostinger; add a record; SSL goes green; site loads over HTTPS.

- **T3.3 Pi domain provider** · M · L2
  Assign a Pi domain from auction inventory; map to current CID/gateway; live in Pi Browser.
  ✅ Accept: assign Pi domain → resolves to live CID in Pi Browser.

- **T3.4 DNS/SSL/subdomain UI** · M · L2
  Plain-language record editor, SSL status, subdomains, forwarding.
  ✅ Accept: non-technical user can add a CNAME + see SSL status without seeing raw errors.

---

## EPIC 4 — AI concierge  *(the moat: "operates WITH you")*

- **T4.1 Build-failure triage** · M · L2 ✅ **DONE (pre-stage)**
  services/concierge/buildFailureTriage.ts: maps 10+ failure patterns (wrong output dir, missing build script, missing dep, Node mismatch, OOM/SIGKILL, lockfile mismatch, TS errors, peer conflicts, timeout) → plain-language explanation + FixAction; 18/18 tests with real failure-log fixtures.
  ✅ Accept: deliberately broken build logs → human explanation + structured fix action.

- **T4.2 Proactive post-deploy summary** · S · L2
  "Live at X. SSL set. Domain pointed. Here's your link." ✅ Accept: shown after real deploy.

- **T4.3 Config concierge** · S · L2
  Guided domain/DNS setup (choose Pi vs real, auto-steps). ✅ Accept: guided flow completes a domain connect.

- **T4.4 Voice/tone + no-raw-codes audit** · S · L2 ✅ **DONE (pre-stage)**
  docs/RAW-CODES-AUDIT.md written with grep evidence; two fixes applied: deployApi.ts fallback message (raw HTTP status → plain language variants per range); ipfs.ts Pinata errors (raw status → provider-agnostic plain language + removed provider name leak); no stack traces in responses; gateway diagnostic codes retained intentionally (accompany full plain-language explanation).
  ✅ Accept: grep + audit finds no raw codes on primary user surfaces.

---

## EPIC 5 — Payments & tiers (Pi, real)

- **T5.1 Server-side payment lifecycle** · M · L3
  approve→complete verified against Pi API; idempotent; PaymentQuote→Invoice.
  ✅ Accept: real test payment produces a paid Invoice exactly once.

- **T5.2 Tier/quota enforcement** · M · L2
  Storage + build quotas per tier, tied to UsageSample. ✅ Accept: over-quota deploy is refused with plain message.

- **T5.3 Billing plain-language final audit** · S · L2
  ✅ Accept: invoices/statuses read in plain English; no codes.

---

## EPIC 6 — Release gate  *(verify-by-execution)*

- **T6.1 Full real-journey e2e** · L · L2
  Pi sign-in → GitHub project → isolated build → pin → verified live link → connect Pi + real
  domain + SSL → pay tier → malicious deploy BLOCKED/held → operator takedown works.
  ✅ Accept: entire chain passes on real integrations, driven headlessly.

- **T6.2 Governance + CI evals** · M · L2
  Drop `.github/devright-agent-governance.json`; CI evals ≥90% pass; tracing/observability hooks.

- **T6.3 Security scan clean** · S · L2
  Secret scan + dependency audit clean (or documented + accepted).

- **T6.4 Production deploy** · S · L3
  ✅ Accept: live URL serves the real app (HTTP 200, real content), verified independently.

---

## Blocked-by summary (get these from Brenden to go real)
- Railway token → E0.3, E1, backends.
- Pinata JWT → E0.1.
- Pi Portal app key+secret → E0.2, E5.
- Confirm Hostinger-wrap for web2 domains → E3.2.
- Pi domain inventory list → E3.3.

## Pre-stageable NOW with $0 / no keys (optional, if budget allowed)
DomainProvider interface + stubs (T3.1), AUP text + attestation schema (T2.1),
scanner module skeleton + fixtures (T2.2), concierge failure→fix map (T4.1),
no-raw-codes audit (T4.4). These are additive and need no external calls.
