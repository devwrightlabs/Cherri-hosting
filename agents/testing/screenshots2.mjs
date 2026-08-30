/**
 * agents/testing/screenshots2.mjs
 *
 * Take screenshots including the live IPFS-deployed content and API endpoints.
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const OUT_DIR = path.join(fileURLToPath(import.meta.url), '..', 'out', 'cherri-golive');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = 'http://localhost:4000';
const WIDTH = 390;
const HEIGHT = 844;

const browser = await chromium.launch({ headless: true });

async function shot(name, url, waitFn) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (waitFn) await waitFn(page);
    else await page.waitForTimeout(2000);
    const fp = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: fp, fullPage: true });
    const size = fs.statSync(fp).size;
    console.log(`✓ ${name} (${size} bytes)`);
    await page.close();
    return fp;
  } catch(e) {
    const fp = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: fp }).catch(() => {});
    console.log(`~ ${name} (partial: ${e.message.slice(0, 80)})`);
    await page.close();
    return fp;
  }
}

// 1. Health check
await shot('healthz', `${BASE}/healthz`, async (page) => {
  await page.waitForSelector('pre, body');
});

// 2. Ready check (shows DB + integrations status)
await shot('readyz', `${BASE}/readyz`, async (page) => {
  await page.waitForSelector('pre, body');
});

// 3. API status (shows pinata=true, pi=true)
await shot('api-status', `${BASE}/api/status`, async (page) => {
  await page.waitForSelector('pre, body');
});

// 4. React app landing (will show loading spinner due to Pi SDK)
await shot('react-landing', `${BASE}/`, async (page) => {
  await page.waitForTimeout(4000); // wait for loader
});

// 5. Live IPFS-deployed TEST2 (Vite+React build)
const TEST2_CID = 'bafybeidhf3j5bpq7dkztfb36d35vz56qe5f5fdfresrtrwgily6k6yhr2e';
await shot('live-ipfs-test2', `https://${TEST2_CID}.ipfs.dweb.link/`, async (page) => {
  // Wait for content to appear
  try {
    await page.waitForSelector('body', { timeout: 15000 });
    await page.waitForTimeout(3000);
  } catch(e) { /* content may still show */ }
});

// 6. The demo URL (dweb.link)
await shot('live-demo-app', `https://${TEST2_CID}.ipfs.dweb.link/`, async (page) => {
  await page.waitForTimeout(5000);
});

await browser.close();
console.log('\nDone. Screenshots at:', OUT_DIR);
