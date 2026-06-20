/**
 * Opens an external URL (e.g. Pi Domains portal) without touching Pi auth,
 * the Pi SDK, or the SPA router. The Pi Browser handles deep-linking natively
 * from a clean window.open; let it authenticate on the destination itself.
 *
 * Do NOT call Pi.authenticate() / Pi.init() / any router navigate here.
 * Do NOT use Next/React Router <Link> for external URLs.
 * Do NOT gate this behind an auth check or re-auth on click or on return.
 */
export function openExternal(url: string): void {
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    window.location.assign(url);
  }
}
