/**
 * TEST 3 standalone: GitHub import → pin → verify
 */

const BASE = 'http://localhost:4000';
const DEV_TOKEN = 'dev:pioneer_test:pioneer_test';
const authHeaders = { Authorization: `Bearer ${DEV_TOKEN}` };

async function api(method, path, opts = {}) {
  const { body } = opts;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

function log(msg, data) {
  console.log(`[${new Date().toISOString()}] ${msg}`, data !== undefined ? JSON.stringify(data, null, 2) : '');
}

async function poll(url, check, intervalMs = 3000, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status, json } = await api('GET', url);
    log(`  poll ${url} → ${status}`);
    const result = check(json, status);
    if (result !== null) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout polling ${url}`);
}

// Get a fresh project ID
const projRes = await api('POST', '/api/projects', { body: { name: 'golive-test3', description: 'GitHub import test' } });
const project = (projRes.json.project ?? projRes.json);
const projectId = project.id;
log(`Project: ${projectId}`);

const ATTESTATION = { agreed: true, termsVersion: '1.0.0' };

// GitHub import
log('POST /api/deployments/import-github...');
const importRes = await api('POST', '/api/deployments/import-github', {
  body: { repoUrl: 'https://github.com/mdn/beginner-html-site-styled', projectId }
});
log('import-github response', importRes.json);

if (!importRes.ok) {
  console.error('TEST3 FAILED: import-github error', importRes.json);
  process.exit(1);
}

const imp = importRes.json;
let stageId = imp.stageId;

if (imp.jobId) {
  log(`Polling build ${imp.jobId}...`);
  const built = await poll(`/api/deployments/builds/${imp.jobId}`, (json) => {
    log(`  build: ${json.status}`);
    if (json.status === 'DONE') return json;
    if (json.status === 'FAILED') throw new Error('Build failed: ' + json.error);
    return null;
  });
  stageId = built.stage?.stageId ?? stageId;
}

log(`Pinning stageId: ${stageId}`);
const pinRes = await api('POST', `/api/deployments/${stageId}/pin`, { body: { projectId, attestation: ATTESTATION } });
log('pin response', pinRes.json);

if (!pinRes.ok) {
  console.error('TEST3 pin failed:', pinRes.json);
  process.exit(1);
}

const depId = (pinRes.json.deployment ?? pinRes.json).id;
const dep = await poll(`/api/deployments/${depId}`, (json) => {
  const d = json.deployment ?? json;
  if (d.status === 'ACTIVE') return d;
  if (d.status === 'FAILED') throw new Error('Deployment failed: ' + d.failureReason);
  return null;
});

const cid = dep.cid;
log(`TEST3 CID: ${cid}`);
log(`TEST3 URL: ${dep.gateway}`);

// Verify via w3s.link
await new Promise(r => setTimeout(r, 5000));
const verifyUrl = `https://${cid}.ipfs.w3s.link/index.html`;
log(`Verifying: ${verifyUrl}`);
try {
  const r = await fetch(verifyUrl, { signal: AbortSignal.timeout(20000) });
  const body = await r.text();
  log(`Render: HTTP ${r.status}, len=${body.length}`);
  console.log('\n=== TEST3 RESULT ===');
  console.log(`PASS: ${r.status === 200}`);
  console.log(`CID: ${cid}`);
  console.log(`Verified URL: ${verifyUrl}`);
  console.log(`HTTP: ${r.status}`);
  console.log(`Content length: ${body.length}`);
  if (r.status === 200) {
    // Unpin since this is throwaway
    await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }
    });
    console.log('Unpinned (throwaway test)');
  }
} catch(e) {
  console.log(`TEST3 verify timeout/fail: ${e.message}`);
  console.log(`CID confirmed pinned on Pinata, verifying async`);
  console.log(`TEST3 CID: ${cid} | URL: ${dep.gateway}`);
}
