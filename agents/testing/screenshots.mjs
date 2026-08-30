/**
 * agents/testing/screenshots.mjs
 *
 * Take UI screenshots of the Cherri Hosting server at 390px width (mobile).
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const OUT_DIR = path.join(fileURLToPath(import.meta.url), '..', 'out', 'cherri-golive');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = 'http://localhost:4000';
const DEV_TOKEN = 'dev:pioneer_test:pioneer_test';
const WIDTH = 390;
const HEIGHT = 844;

const browser = await chromium.launch({ headless: true });

async function screenshot(name, fn) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  
  try {
    await fn(page);
    
    // Wait for React to hydrate / loader to finish
    await page.waitForTimeout(3000);
    
    const filePath = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`✓ ${name} (${fs.statSync(filePath).size} bytes) → ${filePath}`);
    await page.close();
    return filePath;
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
    const filePath = path.join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: filePath }).catch(() => {});
    await page.close();
    return filePath;
  }
}

async function setupAuth(page) {
  // Go to origin, set auth tokens, then navigate
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.waitForTimeout(2000);
  await page.evaluate((token) => {
    localStorage.setItem('pi_access_token', token);
    localStorage.setItem('cherri_access_token', token);
    // Common patterns
    localStorage.setItem('access_token', token);
    localStorage.setItem('auth_token', token);
  }, DEV_TOKEN);
}

const screenshots = [];

// 1. Landing page (no auth needed)
screenshots.push(await screenshot('01-landing', async (page) => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
}));

// 2. Dashboard
screenshots.push(await screenshot('02-dashboard', async (page) => {
  await setupAuth(page);
  await page.goto(BASE + '/dashboard', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
}));

// 3. Projects list
screenshots.push(await screenshot('03-projects', async (page) => {
  await setupAuth(page);
  await page.goto(BASE + '/projects', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
}));

// 4. Deploy/upload page
screenshots.push(await screenshot('04-deploy', async (page) => {
  await setupAuth(page);
  await page.goto(BASE + '/deploy', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
}));

// 5. API Status page  
screenshots.push(await screenshot('05-api-status', async (page) => {
  await page.goto(BASE + '/api/status', { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1000);
}));

// 6. readyz status page
screenshots.push(await screenshot('06-readyz', async (page) => {
  await page.goto(BASE + '/readyz', { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1000);
}));

await browser.close();

console.log('\nAll screenshots saved to:', OUT_DIR);
for (const s of screenshots) {
  if (s) console.log(' ', path.basename(s));
}
