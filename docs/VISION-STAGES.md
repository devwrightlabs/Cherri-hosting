# Cherri Hosting — Vision, Security Model & Staged Roadmap

> Canonical product/architecture brief. "Builds like Vercel, configures like Hostinger,
> hosts like IPFS+Pi, isolated by Railway." Grounds Stage 1 (zero→one) and the flip to
> Stage 2+. Fill technical gaps with judgment consistent with this doc.

---

## 1. The mental model (what Cherri actually is)

Four jobs, four providers, one seamless UX:

| Job | Cherri's answer | Why |
|-----|-----------------|-----|
| **BUILD** (like Vercel) | Take a GitHub repo / uploaded folder / pasted source / Replit-Cursor export → run real install+build → produce a static bundle (or a backend image). | Bypass paid builders (Replit, Pi App Studio, Lovable). |
| **ISOLATE** (the hard part) | Every build runs in an **ephemeral Railway container** — throwaway, resource-capped, no access to Cherri secrets or other users' data, killed after build. | We run STRANGERS' code. Current host can't sandbox it. |
| **HOST** | Static output → **IPFS via Pinata** (content-addressed CID) served through Cherri's gateway; backends → **Railway services**. | Decentralized, cheap, Pi-ecosystem-native. |
| **CONFIGURE** (like Hostinger) | Full domain + DNS + SSL + backend/env/DB config panel, driven by an AI concierge. | "I want it to configure everything backend for domains too." |

The wedge: **static hosting is the safe, cheap default** (no code runs in production — it's just files on IPFS). Railway cost is only incurred at *build time* (ephemeral) and for users who *opt into backends* (paid tier). Cost tracks revenue.

---

## 2. What already exists (build on this, don't rebuild)

- **Client:** React 18 + Vite + TS + Tailwind. Dashboard, deploy, billing, account pages.
- **Server:** Node + Express + TS. Routes: `auth, billing, deploy, deployments, invoices, notifications, operatorCostControl, operatorGoLive`.
- **Build pipeline:** `buildService.ts` — real install+build, sanitized env (secrets never exposed), isolated temp dir, wall-clock timeouts, output caps, concurrency=1.
- **Security policy:** `buildSecurity.ts` — strict/balanced/permissive modes, install-script blocking + vetted rebuild allowlist, best-effort ulimits. **Honestly declares `containerized:false`** and exposes a GATED seam `describeRemoteBuilder` that stays BLOCKED until Railway exists. ← This is the flip point.
- **Data:** Prisma models for User, Project, Deployment, BackendService, DbSnapshot, DbBackup, UsageSample, OperatorAlert, OperatorCostControlConfig, GoLiveConfig, Subscription, PiSubscription, BillingEvent, PaymentQuote, Invoice, Notification, SupportTicket.
- **Deploy UX:** two-stage Build → Verify → Deploy; verified live links; plain-language invoices/statuses (raw status codes removed).
- **State:** 110/113 tests pass; 3 gated on paid Railway. Pinata pinning real (fixed the "more than one file" 400).

---

## 3. Security architecture (the crux — protecting the Pi ecosystem)

Split the risk model by deploy type. Do NOT treat them the same.

### 3a. Static deploys = CONTENT risk only
No server code runs in production. The only danger is *what the files are* (phishing, malware distribution, illegal software/products, scams targeting Pi users). Defenses:
- **Pi-identity accountability** — every deploy is tied to a verified Pi Network human (Sign in with Pi). Not anonymous like Vercel. We can ban the *identity*, not just the site. This is our single biggest advantage.
- **Acceptable Use Policy** at signup + **per-deploy attestation** ("this is not illegal/malware/phishing").
- **Pre-publish scan** on build output: known-malware signatures, phishing/scam heuristics, obfuscated-JS flags, credential-harvest form detection, URL reputation on outbound links.
- **Operator review lane** — flagged deploys route to `operatorGoLive` for human approval before going live.
- **Takedown = UNPIN.** Kill switch: unpin from Pinata + drop gateway/domain mapping. Build the operator takedown flow now.

### 3b. Build-time = CODE-EXECUTION risk (Railway solves this)
Malicious install/build scripts (miners, exfil, supply-chain). Defenses:
- **Ephemeral Railway build container** per build — the real answer to `containerized:false`. Isolated FS, own resource cgroup, no Cherri secrets, destroyed after build.
- **Egress policy during build:** allow package registries (npm/pnpm/yarn) + git; block/monitor arbitrary outbound to stop exfil & miner callbacks.
- Keep the existing script-block + allowlist policy as defense-in-depth INSIDE the container.
- Dependency audit (`npm audit` + advisory feed) surfaced to user, never auto-run silently.

### 3c. Backend deploys = RUNTIME risk (Stage 2, strictest gate)
User's server code runs continuously. Defenses:
- Each backend = isolated Railway service, resource-capped, network-policied, logged.
- Runtime abuse monitoring (CPU/egress anomalies, outbound-attack detection).
- Higher trust bar: paid tier + stronger attestation + faster takedown.

**Principle:** ship Stage 1 (static) without solving the hardest runtime problem. Static + Railway-isolated builds is a complete, safe zero-to-one.

---

## 4. Feature union — Vercel side + Hostinger side

### Vercel-style (build/deploy)
- Sources: GitHub URL, folder/zip upload, pasted source, Replit/Cursor/Bolt export import.
- Framework autodetect (Vite/React/Next-static/Astro/plain) + smart build defaults.
- Build logs (real), Build → Verify → Deploy stages, instant rollback to prior CID.
- (Stage 3) Git push → auto-deploy; per-branch preview deploys.

### Hostinger-style (configure everything)
- **Domains:** connect Pi domain (from your auction stash — cuts cost in half) OR a real domain.
- **DNS editor:** A/AAAA/CNAME/TXT/MX/CAA records, plain-language UI.
- **SSL:** auto-provision (Let's Encrypt) for custom domains; auto-renew.
- **Subdomains**, redirects/forwarding.
- **Backends/DB (Stage 2):** provision API + database per app, env/secrets manager, cron jobs, snapshots/backups (models already exist).
- **Email (Stage 3):** mailboxes/forwarders parity.
- Usage/analytics (UsageSample), cache/gateway controls.

### The accelerator play (judgment call)
DevWright already pays for **Hostinger**, and the agent has the **full Hostinger API** (domains, DNS, SSL, email). For the "web2 bridge" side, Cherri should **wrap the Hostinger API as its provider** rather than rebuild registrar/DNS/email/SSL from scratch. Users get: "Pi domain (cheap, Pi-native) **or** real domain (provisioned via Hostinger under the hood)." Best of both worlds, minimal build. IPFS+Pi stay the web3 core.

---

## 5. The AI concierge (the "professional touch you want to listen to")

Not "an AI built this" — **"an AI operates this WITH you."** This is the differentiator.
- **Live build triage:** watches the build; on failure, explains in plain language + offers one-tap fixes ("Build failed: missing output dir. Set it to `dist`? [Fix]").
- **Proactive setup:** "Your site is live at <cid>. I provisioned SSL and pointed your Pi domain. Here's the link."
- **Plain language everywhere** — no raw errors/status codes (already the house style; keep it).
- **Honest, never fakes success** (core value) — a calm, competent, trustworthy voice.
- Zero-config defaults; the user is *guided*, not quizzed.

---

## 6. Staged roadmap

**Stage 1 — zero→one (static, done right):**
GitHub/upload/paste/export → Railway-isolated build → IPFS pin → verified live link → connect Pi/custom domain + auto-SSL. Pi sign-in, Pi payments, subscription tiers. Content-safety gate (Pi identity + AUP + pre-publish scan + operator review + unpin takedown). Domain/DNS config panel (Hostinger-wrapped). AI concierge on the deploy + config flows.
*Mostly exists — needs: Railway build wiring (flip `describeRemoteBuilder`), safety pipeline, domain/DNS UI, concierge polish.*

**Stage 2 — backends:** auto-provision user backends + DB on Railway (isolated), env/secrets, cron, custom API domains, runtime abuse monitoring. Activates BackendService/DbSnapshot/DbBackup models.

**Stage 3 — Hostinger-full-parity:** email, advanced DNS, git-push auto-deploy, preview deploys, teams/collab, template marketplace, one-click apps, analytics.

**Stage 4+ — ecosystem:** Cherri = default host for all DevWright Pi apps; let other Pi devs deploy+monetize; template store.

---

## 7. Open inputs needed from Brenden (unblocks "no-mock" real)
- **Railway token** (unblocks 3 gated tests + build isolation + backends).
- **Pinata JWT** (real IPFS pinning).
- **Pi Developer Portal** app key + secret (live Sign in with Pi + payments).
- Confirm: wrap Hostinger API for web2 domains/DNS/email? (recommended: yes.)
- Pi domain inventory (which auction domains are available to assign).

---

## 8. Refinements to the plan (judgment calls)
1. Railway = build isolation (S1) + backend runtime (S2). Static is served from IPFS, NOT Railway → cost tracks revenue.
2. Split risk by deploy type (static=content, build=code, backend=runtime). Ship static first.
3. Pi identity is the abuse firewall — accountability Vercel can't match. Lean in.
4. Unpin = takedown. Build the operator kill-switch in S1.
5. Wrap Hostinger's API for web2 domains/DNS/SSL/email instead of rebuilding.
6. AI concierge = the moat. "Operates with you," premium + honest voice.
7. `describeRemoteBuilder` is the pre-built flip seam — Stage 1 is a *wire-up*, not a rewrite.
