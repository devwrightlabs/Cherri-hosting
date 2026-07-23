---
name: Static bundle hardening (white-screen fix)
description: Universal post-build path-relativization + base-tag + 404 + verify so every pinned site renders on a non-root IPFS/Pi-Browser gateway path.
---

# Universal white-screen fix

Built SPAs bake **root-absolute** asset refs (`/assets/index-x.js`). Cherri serves
every site from a NON-root path (`/ipfs/<cid>/…`, Pi Browser gateway,
`/preview/<id>/`), so a leading `/` 404s → blank page. The fix is a pure, idempotent,
framework-agnostic hardening transform applied **just before pinning**.

## Where it runs — the one chokepoint
`executePin()` in `routes/deployments.ts` is the SINGLE point both deploy flows pass
through before `pinDirectory()`: the legacy one-shot deploy AND the staged "deploy to
IPFS" pin. Harden there and every pinned site is covered. Order inside executePin:
`hardenStaticBundle` → (conditional) `injectCherriRuntimeConfig` → `verifyReferencedAssets`
→ **final quota re-check** → `pinDirectory`.

**Why this order:** harden first so the `<base>` tag lands before the cherri config
script (which injects at end-of-head); verify the EXACT bytes that will be pinned.

## What the transform does (`utils/staticHardening.ts`)
- HTML: rewrite root-absolute asset refs `/x`→`./x` on asset-bearing tags only
  (`script/link/img/source/video/audio/track/iframe/embed/object`, plus `srcset`);
  NEVER `<a>/<area>/<base>`. Skip `http:`, `//`, `data:`, `blob:`, `mailto:`, `tel:`, `#`.
- Inject `<base href="…">` into `<head>` **only if absent** — depth-aware (`./` for root
  `index.html`, `../`×depth for nested HTML) so it points at the SITE ROOT.
- CSS: rewrite `url(/…)` depth-aware **relative to the stylesheet** — the `<base>` tag does
  NOT affect CSS `url()` resolution, so CSS must carry its own `../` hops.
- Add `404.html` mirroring the hardened root index (SPA fallback), only if absent.
- `verifyReferencedAssets`: confirm the entry `index.html`'s render-critical `script src` +
  `stylesheet`/`modulepreload` `href` exist at resolved bundle paths; missing ⇒ throw
  `WhiteScreenRiskError` (surfaces via `describePinError` → deployment FAILED, honest HALT,
  never pin a known white screen).

## Hard-won decisions
- **JS string-literal rewriting must be EXISTENCE-GATED, never blind.** A blind
  `"/x"`→`"./x"` replace is WRONG for ESM dynamic imports (they resolve relative to the
  MODULE url — a chunk already in `/assets/` would yield `/assets/assets/…`). The shipped
  approach: rewrite a root-absolute literal in a JS file ONLY when the exact path exists as
  a file in the bundle, and skip literals directly preceded by `import(`/`from ` prefixes;
  plus a separate marker-gated rewrite of Vite's preload-helper `return"/"+dep` →
  `return"./"+dep`. Runtime-fetch paths (`fetch('/data.json')`) are what this fixes.
  (Architect-reviewed; 7 unit tests in `staticHardening.test.ts`.)
- **Quota must be re-checked AFTER hardening.** The route-level gate runs on pre-hardening
  size; the `404.html` mirror (≈ a second index.html) + config injection add bytes. Re-sum
  `filesToPin` and compare to `storageUsed + finalBytes > storageLimit` inside executePin
  before pinning, else additions slip a deploy over quota. **Why:** caught in review as a
  real quota-bypass.
- **Idempotent**: already-relative paths, an existing `<base>`, and an existing `404.html`
  are all left alone — re-running (e.g. staged files re-hardened at pin) is a no-op.
- Mirrors `frontendConfig.ts:injectCherriRuntimeConfig` (pure, returns new `DeployFile[]`).

## Known limitation (do not over-claim)
The `404.html` mirror carries a relative `<base>`, so for a DEEP link
(`/ipfs/<cid>/some/route`) the browser URL is still the deep path and `./assets/…` resolves
under it → assets 404. Deep-link asset resolution is inherent to relative-path hosting; the
spec hedges it ("AND/OR ensure the app can run from index.html; prefer hash routing"). Root
entry + shallow nav render correctly. Don't add an app-specific redirect hack (breaks
non-hash routers).

## Not done (deferred, by scope)
Preview parity: `/preview/<id>/` serves pre-hardening `stage.files`, so the preview can
still white-screen even though the PINNED site renders. To fix, harden before each
`createStage()` and recompute `totalBytes`/`fileCount` (architect-noted). Out of scope for
the "before pin" task; the pinned site is the deliverable.
