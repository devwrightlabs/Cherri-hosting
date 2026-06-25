import { useEffect, useState } from 'react';
import { statusApi, SystemStatus } from '../lib/api';

/**
 * Polls the server's system status (~60s) and shows a single non-blocking banner
 * when something is degraded:
 *  - A backend-provider OUTAGE is shown prominently, but always framed honestly:
 *    sites already on IPFS stay live; only backend/database features are down. It
 *    NEVER reveals which provider Cherri uses.
 *  - An unavailable optional integration (IPFS/payments) shows a config notice.
 * Stays silent when everything is operational.
 */
const POLL_MS = 60_000;

export default function SystemStatusBanner() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      statusApi
        .get()
        .then((res) => {
          if (active) setStatus(res.data);
        })
        .catch(() => {
          // Status is best-effort; if it fails we simply show nothing rather
          // than alarming the user with a false outage.
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!status) return null;

  // A backend-provider outage takes priority — it's the most impactful, and the
  // message reassures users their IPFS sites are unaffected.
  if (status.backendProvider.state === 'outage') {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3"
      >
        <span className="text-lg leading-none" aria-hidden="true">
          🛠️
        </span>
        <div className="text-sm">
          <p className="font-medium text-rose-300">
            Backend services temporarily unavailable
          </p>
          <p className="text-rose-400/90">{status.backendProvider.message}</p>
        </div>
      </div>
    );
  }

  const issues: string[] = [];
  if (!status.integrations.pinata) issues.push('IPFS deployments are paused');
  if (!status.integrations.pi) issues.push('Pi Network payments are unavailable');

  if (issues.length === 0) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3"
    >
      <span className="text-lg leading-none" aria-hidden="true">
        ⚠️
      </span>
      <div className="text-sm">
        <p className="font-medium text-amber-300">Limited service</p>
        <p className="text-amber-400/90">
          {issues.join(' · ')}. This is a server configuration issue and will
          resolve once the integration credentials are set.
        </p>
      </div>
    </div>
  );
}
