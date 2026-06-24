/**
 * Cherri front-end runtime config injection (Phase 3 — env split)
 *
 * THE CHERRI FRONT-END CONFIG CONTRACT
 * ------------------------------------
 * A project's front-end is pinned to public IPFS, while its backend (when it
 * has one) runs on the landlord provider behind a public URL. The IPFS site has
 * no build-time knowledge of that URL, so Cherri injects it as RUNTIME config,
 * just before pinning, in a deterministic, framework-agnostic way:
 *
 *   1. `cherri.config.json` is written at the bundle root:
 *        { "backendUrl": "https://<app>.example.app" }
 *      A site can `fetch('/cherri.config.json')` to read it.
 *
 *   2. A single marked <script data-cherri-config> is injected into the root
 *      index.html <head>, setting:
 *        window.__CHERRI__ = Object.freeze({ backendUrl: "https://..." });
 *      so a site can read `window.__CHERRI__.backendUrl` synchronously without a
 *      round-trip.
 *
 * This is a CONVENTION, not magic: it does not make an arbitrary app talk to its
 * backend — the app's own code must read `window.__CHERRI__.backendUrl` (or
 * fetch `cherri.config.json`). Cherri's starter templates/SDK follow it.
 *
 * HONESTY + SECURITY:
 *   - Only a validated PUBLIC http(s) URL is ever injected. It is safe to expose
 *     (it is the same URL the browser will call). We NEVER put the Postgres
 *     connection string, provider ids, or any secret into IPFS files — those are
 *     backend-only (and are already stripped from uploads by shouldIgnoreFile).
 *   - The URL is escaped for safe embedding in an HTML <script> (`<`, `>`, `&`,
 *     U+2028, U+2029) to prevent stored XSS / script-breakout.
 *   - The function is pure: it returns a new array and never mutates its input.
 *   - It is idempotent: re-running replaces the prior config file + marked
 *     script instead of stacking duplicates.
 */

import { DeployFile } from './deployFiles';

/** Thrown when the backend URL is not a valid public http(s) URL. */
export class InvalidBackendUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackendUrlError';
  }
}

export const CHERRI_CONFIG_FILENAME = 'cherri.config.json';
/** Marker attribute on the injected <script> so we can find + replace it. */
const SCRIPT_MARKER = 'data-cherri-config';
/** Matches a previously-injected marked script for idempotent replacement. */
const EXISTING_SCRIPT_RE = /<script\s+data-cherri-config\b[\s\S]*?<\/script>\s*/gi;

/**
 * Validate and normalize a backend URL. Must be an absolute http(s) URL with a
 * host. Returns the normalized href (no trailing slash on a bare origin).
 */
export function normalizeBackendUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    throw new InvalidBackendUrlError('Backend URL is empty.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidBackendUrlError(`Backend URL is not a valid URL: ${trimmed}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidBackendUrlError(
      `Backend URL must use http or https (got "${url.protocol}").`,
    );
  }
  if (!url.hostname) {
    throw new InvalidBackendUrlError('Backend URL has no host.');
  }
  // A URL injected into a public IPFS bundle must never carry credentials —
  // userinfo would leak a secret into world-readable files.
  if (url.username || url.password) {
    throw new InvalidBackendUrlError('Backend URL must not contain credentials.');
  }
  // Drop a lone trailing slash for a bare origin so the value is clean.
  const href = url.toString();
  return url.pathname === '/' && !url.search && !url.hash
    ? href.replace(/\/$/, '')
    : href;
}

/**
 * Serialize a value for safe inlining inside an HTML <script> tag. Escapes the
 * characters that could break out of the script element or the surrounding
 * markup, plus the JS line separators that are illegal in JS string literals.
 */
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Build the marked <script> line that exposes window.__CHERRI__. */
function buildConfigScript(backendUrl: string): string {
  const json = safeJsonForScript({ backendUrl });
  return `<script ${SCRIPT_MARKER}>window.__CHERRI__=Object.freeze(${json});</script>`;
}

/**
 * Inject the marked config script into an HTML document, replacing any prior
 * injected one. Inserts before </head> when present, else before <body>, else
 * prepends to the document.
 */
function injectScriptIntoHtml(html: string, script: string): string {
  const withoutOld = html.replace(EXISTING_SCRIPT_RE, '');
  const headClose = /<\/head\s*>/i;
  if (headClose.test(withoutOld)) {
    return withoutOld.replace(headClose, (m) => `  ${script}\n${m}`);
  }
  const bodyOpen = /<body\b[^>]*>/i;
  if (bodyOpen.test(withoutOld)) {
    return withoutOld.replace(bodyOpen, (m) => `${m}\n  ${script}`);
  }
  return `${script}\n${withoutOld}`;
}

/**
 * Inject the Cherri runtime backend config into a front-end bundle.
 *
 * PURE + IDEMPOTENT: returns a new DeployFile[]; the input is untouched.
 * Writes/replaces `cherri.config.json` at the bundle root and, when a root
 * `index.html` exists, injects/replaces the marked config <script>.
 *
 * @throws InvalidBackendUrlError if backendUrl is not a public http(s) URL.
 */
export function injectCherriRuntimeConfig(
  files: DeployFile[],
  backendUrl: string,
): DeployFile[] {
  const normalized = normalizeBackendUrl(backendUrl);

  const configJson = JSON.stringify({ backendUrl: normalized }, null, 2) + '\n';
  const configFile: DeployFile = {
    path: CHERRI_CONFIG_FILENAME,
    buffer: Buffer.from(configJson, 'utf8'),
    mimeType: 'application/json',
  };

  const script = buildConfigScript(normalized);

  const out: DeployFile[] = [];
  for (const f of files) {
    // Drop any prior config file — we re-add a fresh one below (idempotency).
    if (f.path === CHERRI_CONFIG_FILENAME) continue;
    if (f.path === 'index.html') {
      const html = f.buffer.toString('utf8');
      out.push({
        ...f,
        buffer: Buffer.from(injectScriptIntoHtml(html, script), 'utf8'),
      });
    } else {
      out.push(f);
    }
  }
  out.push(configFile);
  return out;
}
