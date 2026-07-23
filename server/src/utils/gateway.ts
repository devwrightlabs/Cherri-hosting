/**
 * Live-URL derivation for pinned IPFS content.
 *
 * WHY THIS EXISTS: Pinata's PUBLIC gateway (gateway.pinata.cloud) blocks HTML
 * content (their ERR_ID:00023 restriction) and shows directory listings for
 * bare CID paths — so a "live link" built from the public gateway can never
 * render a site. A dedicated Pinata gateway (<subdomain>.mypinata.cloud, from
 * the operator's Pinata dashboard "Gateways" tab) serves HTML normally.
 *
 * DESIGN: URLs are DERIVED AT READ TIME from the CID + current env, via this
 * single helper, everywhere a live link is shown or checked. The stored
 * `Deployment.gateway` column is legacy display data — deriving at read time
 * means old deployments automatically get the dedicated gateway the moment the
 * operator configures it, with no backfill.
 *
 * HONESTY: when no dedicated gateway is configured we still return the public
 * URL (the content IS on IPFS and the CID is real), but callers must surface
 * that HTML will likely be blocked — never pretend the link renders.
 */

const PUBLIC_GATEWAY_HOST = 'gateway.pinata.cloud';

/** CIDv0/v1 shape guard — prevents path injection into derived URLs. */
export function isValidCid(cid: string): boolean {
  return /^[A-Za-z0-9]{10,}$/.test(cid);
}

/**
 * The operator's dedicated Pinata gateway host (e.g. "example.mypinata.cloud"),
 * normalized (protocol/trailing-slash stripped), or null when not configured.
 */
export function dedicatedGatewayHost(): string | null {
  const raw = process.env.PINATA_DEDICATED_GATEWAY?.trim();
  if (!raw) return null;
  const host = raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .trim();
  // A gateway host is a bare domain — reject anything that doesn't look like one.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    return null;
  }
  return host.toLowerCase();
}

export function isDedicatedGatewayConfigured(): boolean {
  return dedicatedGatewayHost() !== null;
}

/**
 * Canonical live URL for a pinned CID. Points at the entry file (so the
 * gateway renders the site, not a folder listing) when one is known.
 */
export function liveUrlForCid(cid: string, entryPath?: string | null): string {
  if (!isValidCid(cid)) {
    throw new Error('Invalid CID — refusing to build a live URL from it.');
  }
  const host = dedicatedGatewayHost() ?? PUBLIC_GATEWAY_HOST;
  const base = `https://${host}/ipfs/${cid}`;
  if (!entryPath) return base;
  // Entry paths are bundle-relative ("index.html"); encode each segment.
  const encoded = entryPath
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/');
  return `${base}/${encoded}`;
}

/**
 * Re-derive the live URL for a deployment row at serialization time so every
 * display surface (deploy reveal, project lists, dashboard, QR codes) shows the
 * dedicated-gateway URL when configured — including legacy rows whose stored
 * `gateway` column predates it. Rows without a CID pass through untouched.
 */
export function withLiveUrl<T extends { cid: string | null; gateway?: string | null; entryPath?: string | null }>(
  deployment: T,
): T {
  const cid = deployment.cid;
  if (!cid || !isValidCid(cid)) return deployment;
  return { ...deployment, gateway: liveUrlForCid(cid, deployment.entryPath ?? null) };
}
