/**
 * Universal static-bundle hardening — the "white-screen fix"
 *
 * THE PROBLEM
 * -----------
 * A built SPA (Vite, CRA, Vue, Astro, …) references its assets with ROOT-ABSOLUTE
 * paths baked in at build time:
 *
 *     <script src="/assets/index-abc.js">   <link href="/assets/index-abc.css">
 *
 * On a clean domain root these work. But Cherri serves every site from a place
 * that is NOT a domain root — an IPFS gateway path (`/ipfs/<cid>/…`), the Pi
 * Browser's decentralised gateway, or a `/preview/<id>/` subpath. There a leading
 * "/" resolves to the gateway root, the asset 404s, and the page renders blank —
 * the classic white screen.
 *
 * THE FIX (applied to the built output of EVERY deploy, just before pinning)
 * ------------------------------------------------------------------------
 *   1. Rewrite root-absolute asset references in built HTML to document-relative
 *      ("/assets/x" → "./assets/x") on asset-bearing tags only (never <a>/<area>).
 *   2. Inject `<base href="…">` into <head> (pointing at the SITE ROOT for that
 *      document's depth) so any remaining relative resolution anchors correctly.
 *   3. Rewrite root-absolute `url(/…)` references inside built CSS to be relative
 *      to the stylesheet (the <base> tag does NOT affect CSS url()).
 *   4. Add a 404.html mirroring index.html so gateways that serve 404 for a deep
 *      link still hand back the app shell (SPA fallback).
 *   5. VERIFY: confirm the entry HTML's render-critical JS/CSS actually exist at
 *      their (rewritten) paths. If not, the caller HALTS instead of pinning a
 *      site we already know will white-screen.
 *
 * DESIGN INVARIANTS (mirrors injectCherriRuntimeConfig in frontendConfig.ts):
 *   - PURE: returns a new DeployFile[]; the input array and buffers are untouched.
 *   - IDEMPOTENT: re-running is a no-op (already-relative paths, an existing
 *     <base>, and an existing 404.html are all left alone).
 *   - FRAMEWORK-AGNOSTIC: it inspects the built files, not the toolchain. A plain
 *     static site that already uses relative paths passes through functionally
 *     unchanged.
 *   - JS rewriting is CONSERVATIVE and existence-gated. A quoted root-absolute
 *     literal ("/assets/img-abc.png") inside built JS is rewritten to
 *     document-relative ("./assets/img-abc.png") ONLY when that exact file exists
 *     in the bundle. Document-relative is correct because Rollup/Vite emit
 *     inter-chunk import specifiers as native relative paths already — surviving
 *     root-absolute literals are DOM-consumed (image/font URLs, preload <link>
 *     hrefs), which resolve against the document base, and our injected <base>
 *     anchors every document at the bundle root. As extra insurance, literals
 *     that are dynamic-import specifiers (preceded by `import(` / `from `) are
 *     never touched. Additionally, Vite's preload helper base-join
 *     (`assetsURL = dep => "/" + dep`) is rewritten to `"./" + dep`, gated on the
 *     file containing Vite preload runtime markers, because a failing CSS preload
 *     throws at runtime in Vite 5 (white screen) rather than degrading.
 */

import nodePath from 'path';
import { DeployFile } from './deployFiles';

/**
 * Thrown when the entry HTML references render-critical assets that are not in
 * the bundle — pinning would publish a guaranteed white screen.
 */
export class WhiteScreenRiskError extends Error {
  readonly missing: string[];
  constructor(message: string, missing: string[]) {
    super(message);
    this.name = 'WhiteScreenRiskError';
    this.missing = missing;
  }
}

// Tags whose listed attributes carry a fetchable asset URL. Navigation tags
// (<a>, <area>) and <base> itself are intentionally excluded.
const ASSET_ATTRS_BY_TAG: Record<string, string[]> = {
  script: ['src'],
  link: ['href'],
  img: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  track: ['src'],
  iframe: ['src'],
  embed: ['src'],
  object: ['data'],
};
// Tags that additionally carry a comma-separated srcset of candidate URLs.
const SRCSET_TAGS = new Set(['img', 'source']);

/** A value we should rewrite: a single leading "/" (root-absolute LOCAL path). */
function isRootAbsoluteLocal(val: string): boolean {
  return val.startsWith('/') && !val.startsWith('//');
}

/** How many "../" hops from a file at `path` back to the bundle (site) root. */
function rootPrefixForPath(path: string): string {
  const depth = path.split('/').length - 1;
  return depth <= 0 ? './' : '../'.repeat(depth);
}

/** Rewrite a single quoted attribute's value when it is a root-absolute local path. */
function rewriteAttr(attrs: string, attr: string): string {
  const re = new RegExp(`(\\b${attr}\\s*=\\s*)(["'])([^"']*)\\2`, 'gi');
  return attrs.replace(re, (whole, pre, q, val) =>
    isRootAbsoluteLocal(val) ? `${pre}${q}.${val}${q}` : whole,
  );
}

/** Rewrite each URL token inside a srcset attribute. */
function rewriteSrcsetAttr(attrs: string): string {
  const re = /(\bsrcset\s*=\s*)(["'])([^"']*)\2/gi;
  return attrs.replace(re, (_whole, pre, q, val) => {
    const rewritten = val
      .split(',')
      .map((part: string) => {
        const trimmed = part.trim();
        if (!trimmed) return part;
        const tokens = trimmed.split(/\s+/);
        if (isRootAbsoluteLocal(tokens[0])) tokens[0] = '.' + tokens[0];
        return tokens.join(' ');
      })
      .join(', ');
    return `${pre}${q}${rewritten}${q}`;
  });
}

/**
 * Rewrite root-absolute asset references inside an HTML document to be
 * document-relative. Asset-bearing tags only; <a>/<area>/<base> are skipped, as
 * are external (http:, //), data:, blob:, mailto:, tel: and #anchor values
 * (none of which start with a single "/").
 */
function rewriteHtmlAssetPaths(html: string): string {
  // The attr chunk allows ">" inside quoted values without ending the tag early.
  return html.replace(
    /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (whole, tagName: string, attrs: string) => {
      const tag = tagName.toLowerCase();
      const assetAttrs = ASSET_ATTRS_BY_TAG[tag];
      if (!assetAttrs) return whole;
      let next = attrs;
      for (const attr of assetAttrs) next = rewriteAttr(next, attr);
      if (SRCSET_TAGS.has(tag)) next = rewriteSrcsetAttr(next);
      return `<${tagName}${next}>`;
    },
  );
}

/**
 * Inject `<base href="…">` pointing at the bundle root, unless the document
 * already declares a <base> (we never override an author's intentional base).
 * Inserted as the first child of <head> so it precedes every asset reference.
 */
function injectBaseTag(html: string, htmlPath: string): string {
  if (/<base\b/i.test(html)) return html;
  const baseTag = `<base href="${rootPrefixForPath(htmlPath)}">`;
  const headOpen = /<head\b[^>]*>/i;
  if (headOpen.test(html)) {
    return html.replace(headOpen, (m) => `${m}\n    ${baseTag}`);
  }
  const htmlOpen = /<html\b[^>]*>/i;
  if (htmlOpen.test(html)) {
    return html.replace(htmlOpen, (m) => `${m}\n  ${baseTag}`);
  }
  return `${baseTag}\n${html}`;
}

/**
 * Rewrite root-absolute `url(/…)` references inside CSS to be relative to the
 * stylesheet's own location (the document's <base> tag does not influence CSS
 * url() resolution). Skips data:, blob:, external and protocol-relative URLs.
 */
function rewriteCssAssetPaths(css: string, cssPath: string): string {
  const prefix = rootPrefixForPath(cssPath); // "./" or "../" * depth, to site root
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, q, val) => {
    if (!isRootAbsoluteLocal(val)) return whole;
    // val is "/assets/x"; prefix already ends in "/", so drop val's leading "/".
    return `url(${q}${prefix}${val.slice(1)}${q})`;
  });
}

// ── Conservative JS rewriting ───────────────────────────────────────────────

const JS_EXTS = new Set(['.js', '.mjs', '.cjs']);

// Markers proving a file contains Vite's preload runtime (string literals and
// helper names survive minification).
const VITE_PRELOAD_MARKERS = ['__vitePreload', 'vite:preloadError', 'Unable to preload CSS'];

/**
 * Rewrite quoted root-absolute string literals in built JS to document-relative
 * ("./…") — but ONLY when the literal resolves to a file that actually exists in
 * the bundle, and never when it is an import specifier (`import(` / `from `).
 * Idempotent: already-relative literals start with "." and never match.
 */
function rewriteJsAssetLiterals(js: string, present: Set<string>): string {
  return js.replace(/(["'])(\/[^"'\n]*)\1/g, (whole, q: string, val: string, offset: number) => {
    if (!isRootAbsoluteLocal(val)) return whole;
    const resolved = resolveRefToBundlePath(val);
    if (!resolved || !present.has(resolved)) return whole;
    // Never touch module specifiers: `import("/x")` resolves against the MODULE
    // url, and `from "/x"` is a static import — both are the bundler's domain.
    const before = js.slice(Math.max(0, offset - 12), offset);
    if (/import\s*\(\s*$/.test(before) || /\bfrom\s+$/.test(before)) return whole;
    return `${q}.${val}${q}`;
  });
}

/**
 * Rewrite Vite's preload base-join (`return "/" + dep` / `=> "/" + dep`) to
 * "./" + dep. Only applied to files containing Vite preload runtime markers.
 * The joined values are consumed as <link> hrefs (document-resolved), so
 * document-relative is correct under our injected <base>.
 */
function rewriteVitePreloadBase(js: string): string {
  if (!VITE_PRELOAD_MARKERS.some((m) => js.includes(m))) return js;
  return js
    .replace(/(\breturn\s*)(["'])\/\2(\s*\+)/g, '$1$2./$2$3')
    .replace(/(=>\s*)(["'])\/\2(\s*\+)/g, '$1$2./$2$3');
}

/**
 * Harden a built static bundle so it renders from a non-root gateway path.
 *
 * PURE + IDEMPOTENT + FRAMEWORK-AGNOSTIC. Returns a new DeployFile[]; the input
 * is never mutated. Already-relative sites pass through functionally unchanged
 * (only the additive <base> / 404.html safety nets are introduced, and only when
 * absent).
 */
export function hardenStaticBundle(files: DeployFile[]): DeployFile[] {
  const out: DeployFile[] = [];
  let hardenedRootIndex: Buffer | null = null;
  const present = new Set(files.map((f) => f.path));

  for (const f of files) {
    const ext = nodePath.extname(f.path).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      let html = f.buffer.toString('utf8');
      html = rewriteHtmlAssetPaths(html);
      html = injectBaseTag(html, f.path);
      const buffer = Buffer.from(html, 'utf8');
      if (f.path === 'index.html') hardenedRootIndex = buffer;
      out.push({ ...f, buffer });
    } else if (ext === '.css') {
      const css = f.buffer.toString('utf8');
      out.push({ ...f, buffer: Buffer.from(rewriteCssAssetPaths(css, f.path), 'utf8') });
    } else if (JS_EXTS.has(ext)) {
      let js = f.buffer.toString('utf8');
      js = rewriteJsAssetLiterals(js, present);
      js = rewriteVitePreloadBase(js);
      out.push({ ...f, buffer: Buffer.from(js, 'utf8') });
    } else {
      out.push(f);
    }
  }

  // SPA fallback: mirror the (hardened) root index.html as 404.html so a gateway
  // that 404s a client-side route still returns the app shell. Never clobber an
  // author-provided 404.html.
  if (hardenedRootIndex && !out.some((f) => f.path === '404.html')) {
    out.push({
      path: '404.html',
      buffer: Buffer.from(hardenedRootIndex),
      mimeType: 'text/html',
    });
  }

  return out;
}

/** Pull render-critical asset references (script src, stylesheet/modulepreload href) from HTML. */
function extractCriticalRefs(html: string): string[] {
  const refs: string[] = [];

  const scriptRe = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html))) {
    const src = matchAttr(m[1], 'src');
    if (src) refs.push(src);
  }

  const linkRe = /<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  while ((m = linkRe.exec(html))) {
    const rel = (matchAttr(m[1], 'rel') ?? '').toLowerCase();
    if (/\b(stylesheet|modulepreload)\b/.test(rel)) {
      const href = matchAttr(m[1], 'href');
      if (href) refs.push(href);
    }
  }

  return refs;
}

function matchAttr(attrs: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(["'])([^"']*)\\1`, 'i');
  const m = re.exec(attrs);
  return m ? m[2] : null;
}

/**
 * Resolve an HTML asset reference to a bundle-relative path (no leading slash,
 * forward slashes), or null when it is not a local file we can verify (external,
 * protocol-relative, data:/blob:, anchor, or empty).
 */
function resolveRefToBundlePath(ref: string): string | null {
  const v = ref.trim();
  if (!v) return null;
  // scheme: (http:, data:, blob:, mailto:, tel:, …), protocol-relative //, anchor #
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(v)) return null;
  const clean = v.split('#')[0].split('?')[0];
  if (!clean) return null;
  const stack: string[] = [];
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/**
 * Confirm the entry HTML's render-critical JS/CSS exist in the bundle at their
 * (rewritten) relative paths. Returns the missing references so the caller can
 * HALT with a clear message instead of pinning a white screen.
 *
 * Sites with no root index.html (e.g. a single lone page served under another
 * name) have nothing to verify and pass.
 */
export function verifyReferencedAssets(files: DeployFile[]): {
  ok: boolean;
  missing: string[];
} {
  const index = files.find((f) => f.path === 'index.html');
  if (!index) return { ok: true, missing: [] };

  const present = new Set(files.map((f) => f.path));
  const html = index.buffer.toString('utf8');
  const missing: string[] = [];

  for (const ref of extractCriticalRefs(html)) {
    const resolved = resolveRefToBundlePath(ref);
    if (resolved === null) continue; // external / inline / non-local — not ours to verify
    if (!present.has(resolved)) missing.push(ref);
  }

  return { ok: missing.length === 0, missing };
}
