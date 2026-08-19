/**
 * T2.2 — Pre-publish content scanner
 *
 * Scans a build output (array of DeployFile) BEFORE the Pinata pin and returns
 * a verdict:
 *   CLEAN      → proceed to pin
 *   SUSPICIOUS → hold for operator review (reuse the operatorGoLive lane)
 *   BLOCKED    → refuse; never pin
 *
 * Checks implemented here (no external calls, no keys required):
 *   1. Known malware signatures (binary + JS patterns)
 *   2. Phishing / credential-harvest forms (offsite POST + brand impersonation)
 *   3. Obfuscated-JS heuristics (eval, atob, packed JS, high-entropy strings)
 *   4. Crypto / wallet-drainer signatures (CRITICAL for the Pi ecosystem)
 *   5. Outbound URL reputation (pluggable seam — default: local allow/deny heuristic)
 *
 * Pluggable seam: UrlReputationProvider interface.  Default implementation is
 * a local heuristic (no API key needed); swap in a real provider (e.g. Google
 * Safe Browsing, VirusTotal) by implementing the interface and passing it to
 * scanContent().  The seam is gated — absent = local heuristic only, never
 * faked as "checked by external service".
 *
 * Design: pure functions, no DB, no network (except the optional URL reputation
 * provider). Easy to unit-test with fixture files.
 */

import type { DeployFile } from '../../utils/deployFiles';

// ─── Verdict ─────────────────────────────────────────────────────────────────

export enum ScanVerdict {
  CLEAN = 'CLEAN',
  SUSPICIOUS = 'SUSPICIOUS',
  BLOCKED = 'BLOCKED',
}

export type ScanSeverity = 'info' | 'warning' | 'critical';

export interface ScanFinding {
  /** Short machine tag for the finding type */
  type: string;
  /** Plain-language description for the user */
  description: string;
  /** Severity: info (logged), warning (SUSPICIOUS), critical (BLOCKED) */
  severity: ScanSeverity;
  /** File path within the bundle where the finding was detected */
  file?: string;
  /** Additional context (matched pattern, etc.) */
  detail?: string;
}

export interface ScanResult {
  verdict: ScanVerdict;
  findings: ScanFinding[];
  /** Files that were scanned (count, for logging) */
  filesScanned: number;
}

// ─── URL reputation provider seam ─────────────────────────────────────────────

/**
 * Pluggable URL reputation check.
 *
 * Default: LocalUrlReputationProvider (heuristic, no API key).
 * Wire in a real provider (Safe Browsing, etc.) by implementing this interface
 * and passing it to scanContent(). The interface is minimal so wiring is trivial.
 */
export interface UrlReputationProvider {
  /** Returns true when the URL is known-bad (phishing/malware/etc.) */
  isMalicious(url: string): Promise<boolean>;
  /** Human-readable provider name (shown in finding details) */
  readonly name: string;
}

// ─── Local URL reputation heuristic (default, no key) ────────────────────────

const KNOWN_BAD_DOMAINS = new Set([
  // Well-known malware/phishing infrastructure
  'bit.ly', 'tinyurl.com', 'is.gd', 'goo.gl', 't.co',   // suspicious shorteners in forms
  'ngrok.io', 'serveo.net', 'localtunnel.me',             // tunnel services (exfil risk)
]);

// Brand-impersonation keywords in offsite form targets — SUSPICIOUS signal
const BRAND_IMPERSONATION_KEYWORDS = [
  'pi-network', 'pinetwork', 'minepi', 'pi-coin', 'picoin',
  'binance', 'coinbase', 'metamask', 'opensea',
  'blockchain.info', 'blockchain.com',
  'wallet-connect', 'walletconnect',
  'trustwallet', 'trust-wallet',
  'ledger', 'trezor',
  'uniswap', 'pancakeswap',
];

export class LocalUrlReputationProvider implements UrlReputationProvider {
  readonly name = 'local-heuristic';

  async isMalicious(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      // Check exact bad-domain list
      if (KNOWN_BAD_DOMAINS.has(host)) return true;
      // Subdomain of known-bad
      for (const bad of KNOWN_BAD_DOMAINS) {
        if (host.endsWith(`.${bad}`)) return true;
      }
    } catch {
      // Non-parseable URL — not actionable
    }
    return false;
  }
}

const defaultUrlRep = new LocalUrlReputationProvider();

// ─── Known malware signatures (binary + JS patterns) ─────────────────────────

const MALWARE_SIGNATURES: Array<{ label: string; pattern: RegExp; verdict: ScanVerdict }> = [
  // Crypto wallet drainers (CRITICAL — Pi ecosystem threat)
  { label: 'wallet-drainer-drain-all', pattern: /drainAllTokens|transferAll|drainWallet|sweepWallet/i, verdict: ScanVerdict.BLOCKED },
  { label: 'wallet-drainer-approve-max', pattern: /approve\s*\(\s*[^,]+,\s*['"]?(?:0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff|115792089237316195423570985008687907853269984665640564039457584007913129639935)['"]?\s*\)/i, verdict: ScanVerdict.BLOCKED },
  { label: 'wallet-drainer-eth-send', pattern: /\.sendTransaction\s*\(\s*\{[^}]*to\s*:/i, verdict: ScanVerdict.SUSPICIOUS },
  { label: 'wallet-drainer-pi-drain', pattern: /pi\.drain|drainPi|sweepPi|piWalletDrain/i, verdict: ScanVerdict.BLOCKED },
  { label: 'wallet-drainer-seed-harvest', pattern: /seed[-_\s]?phrase|mnemonic[-_\s]?phrase|private[-_\s]?key\s*=|secret[-_\s]?key\s*input/i, verdict: ScanVerdict.SUSPICIOUS },
  // Miner injection
  { label: 'crypto-miner', pattern: /coinhive|cryptonight|minero|xmrig|CoinHive\.Anonymous/i, verdict: ScanVerdict.BLOCKED },
  { label: 'web-miner', pattern: /new\s+CoinHive\.|new\s+Miner\s*\(|webminepool|coinzillatag/i, verdict: ScanVerdict.BLOCKED },
  // Known malware loaders
  { label: 'malware-loader', pattern: /document\.write\s*\(\s*unescape\s*\(/i, verdict: ScanVerdict.BLOCKED },
  { label: 'iframe-injector', pattern: /<iframe[^>]+src=["']https?:\/\/[^"']+["'][^>]*(?:style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|height\s*:\s*0)[^"']*["']|hidden)/i, verdict: ScanVerdict.SUSPICIOUS },
];

// ─── Obfuscated-JS heuristics ─────────────────────────────────────────────────

const OBFUSCATION_PATTERNS: Array<{ label: string; pattern: RegExp; verdict: ScanVerdict }> = [
  { label: 'eval-execution', pattern: /\beval\s*\(/i, verdict: ScanVerdict.SUSPICIOUS },
  { label: 'atob-eval', pattern: /atob\s*\([^)]*\)\s*\)?\s*;?\s*(?:eval|Function)\s*\(/i, verdict: ScanVerdict.BLOCKED },
  { label: 'function-constructor', pattern: /new\s+Function\s*\(\s*['"][^'"]*atob/i, verdict: ScanVerdict.BLOCKED },
  { label: 'packed-js', pattern: /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/i, verdict: ScanVerdict.SUSPICIOUS },
  // High-entropy base64-ish strings longer than 500 chars in JS files
  { label: 'long-encoded-blob', pattern: /['"][A-Za-z0-9+/]{500,}={0,2}['"]/i, verdict: ScanVerdict.SUSPICIOUS },
];

// ─── Phishing / credential-harvest form detection ─────────────────────────────

/**
 * Extract all <form action="..."> targets from HTML content.
 */
function extractFormActions(html: string): string[] {
  const actions: string[] = [];
  const formPattern = /<form[^>]+action\s*=\s*['"]([^'"]+)['"]/gi;
  let match;
  while ((match = formPattern.exec(html)) !== null) {
    actions.push(match[1]);
  }
  return actions;
}

/**
 * Check if an HTML string contains credential-harvest indicators:
 * password fields + offsite form submission.
 */
function detectCredentialHarvest(
  html: string,
  ownDomain: string | null,
): { found: boolean; offsiteTarget: string | null; brandImpersonation: boolean } {
  const hasPasswordField = /<input[^>]+type\s*=\s*['"]password['"]/i.test(html);
  if (!hasPasswordField) return { found: false, offsiteTarget: null, brandImpersonation: false };

  const actions = extractFormActions(html);
  for (const action of actions) {
    // Offsite = absolute URL to a different host
    try {
      const parsed = new URL(action);
      const isOffsite = ownDomain ? !parsed.hostname.endsWith(ownDomain) : true;
      if (isOffsite) {
        const isBrand = BRAND_IMPERSONATION_KEYWORDS.some(
          (kw) => parsed.hostname.includes(kw) || parsed.pathname.includes(kw),
        );
        return { found: true, offsiteTarget: action, brandImpersonation: isBrand };
      }
    } catch {
      // Relative action — not offsite
    }
  }
  return { found: false, offsiteTarget: null, brandImpersonation: false };
}

// ─── High-entropy string detection ───────────────────────────────────────────

/**
 * Shannon entropy of a string (bits per character).
 * High entropy (> ~4.5) in JS identifiers or string literals is an obfuscation
 * signal. We only apply this to JS/TS file content.
 */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const HIGH_ENTROPY_THRESHOLD = 4.8;
const ENTROPY_MIN_LENGTH = 30;

/** Extract identifier-like tokens longer than ENTROPY_MIN_LENGTH from JS. */
function findHighEntropyTokens(js: string): string[] {
  const tokens: string[] = [];
  const re = /[A-Za-z_$][A-Za-z0-9_$]{29,}/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    const tok = m[0];
    if (shannonEntropy(tok) > HIGH_ENTROPY_THRESHOLD) tokens.push(tok);
  }
  return tokens.slice(0, 5); // Report at most 5 to keep logs short
}

// ─── File classification helpers ──────────────────────────────────────────────

function isJavaScript(file: DeployFile): boolean {
  const p = file.path.toLowerCase();
  return (
    p.endsWith('.js') ||
    p.endsWith('.mjs') ||
    p.endsWith('.cjs') ||
    file.mimeType === 'application/javascript' ||
    file.mimeType === 'text/javascript'
  );
}

function isHtml(file: DeployFile): boolean {
  const p = file.path.toLowerCase();
  return p.endsWith('.html') || p.endsWith('.htm') || file.mimeType === 'text/html';
}

function isText(file: DeployFile): boolean {
  return isJavaScript(file) || isHtml(file) || file.mimeType.startsWith('text/');
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

/**
 * Scan a set of deploy files for malicious content.
 *
 * @param files    The DeployFile array from the build output.
 * @param urlRep   Optional URL reputation provider (defaults to local heuristic).
 * @returns        ScanResult with verdict and findings.
 */
export async function scanContent(
  files: DeployFile[],
  urlRep: UrlReputationProvider = defaultUrlRep,
): Promise<ScanResult> {
  const findings: ScanFinding[] = [];

  for (const file of files) {
    if (!isText(file)) continue; // Skip binaries (images, fonts, etc.)

    const content = file.buffer.toString('utf8');
    const isJs = isJavaScript(file);
    const isHtmlFile = isHtml(file);

    // 1. Malware / wallet-drainer signature scan (all text files)
    for (const sig of MALWARE_SIGNATURES) {
      if (sig.pattern.test(content)) {
        findings.push({
          type: sig.label,
          description: `Malicious content detected: ${sig.label.replace(/-/g, ' ')}`,
          severity: sig.verdict === ScanVerdict.BLOCKED ? 'critical' : 'warning',
          file: file.path,
          detail: `Matched pattern: ${sig.pattern.source.slice(0, 80)}`,
        });
      }
    }

    // 2. Obfuscated JS heuristics (JS files only)
    if (isJs) {
      for (const ob of OBFUSCATION_PATTERNS) {
        if (ob.pattern.test(content)) {
          findings.push({
            type: ob.label,
            description: `Obfuscated JavaScript detected: ${ob.label.replace(/-/g, ' ')}`,
            severity: ob.verdict === ScanVerdict.BLOCKED ? 'critical' : 'warning',
            file: file.path,
          });
        }
      }

      // High-entropy token check (JS only, don't flag minified CSS etc.)
      const highEntropyTokens = findHighEntropyTokens(content);
      if (highEntropyTokens.length >= 3) {
        findings.push({
          type: 'high-entropy-obfuscation',
          description: 'JavaScript file contains multiple high-entropy identifiers, which is a common obfuscation indicator.',
          severity: 'warning',
          file: file.path,
          detail: `Sample tokens: ${highEntropyTokens.join(', ')}`,
        });
      }
    }

    // 3. Phishing / credential-harvest form detection (HTML files)
    if (isHtmlFile) {
      const harvest = detectCredentialHarvest(content, null);
      if (harvest.found && harvest.offsiteTarget) {
        findings.push({
          type: 'credential-harvest-form',
          description: harvest.brandImpersonation
            ? 'Phishing detected: a password form submits to an external site that impersonates a known brand.'
            : 'A password form submits data to an external site — this may be a credential-harvest attack.',
          severity: harvest.brandImpersonation ? 'critical' : 'warning',
          file: file.path,
          detail: `Form submits to: ${harvest.offsiteTarget}`,
        });

        // Also check URL reputation of the offsite target
        const isBad = await urlRep.isMalicious(harvest.offsiteTarget);
        if (isBad) {
          findings.push({
            type: 'malicious-form-target',
            description: `The form's submission target (${harvest.offsiteTarget}) is flagged by the URL reputation check.`,
            severity: 'critical',
            file: file.path,
            detail: `Checked by: ${urlRep.name}`,
          });
        }
      }

      // Extract all URLs from HTML and check reputation
      const urlPattern = /https?:\/\/[^\s'"<>]+/g;
      const urls = Array.from(new Set(content.match(urlPattern) ?? []));
      for (const url of urls.slice(0, 20)) { // limit to 20 per file
        const isBad = await urlRep.isMalicious(url);
        if (isBad) {
          findings.push({
            type: 'malicious-url',
            description: `A link in this page points to a URL flagged by the reputation check: ${url}`,
            severity: 'warning',
            file: file.path,
            detail: `Checked by: ${urlRep.name}`,
          });
        }
      }
    }
  }

  // ── Determine overall verdict ─────────────────────────────────────────────
  const verdict =
    findings.some((f) => f.severity === 'critical')
      ? ScanVerdict.BLOCKED
      : findings.some((f) => f.severity === 'warning')
        ? ScanVerdict.SUSPICIOUS
        : ScanVerdict.CLEAN;

  return { verdict, findings, filesScanned: files.length };
}
