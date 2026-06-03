import { useEffect, useState } from 'react';
import { statusApi, IntegrationStatus } from '../lib/api';

/**
 * Fetches the server's integration status once on mount (no polling) and, when
 * an optional external service is unavailable, shows a single non-blocking
 * banner so users understand why a feature (deploys / payments) may be
 * temporarily disabled. Stays silent when everything is configured.
 */
export default function SystemStatusBanner() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);

  useEffect(() => {
    let active = true;
    statusApi
      .get()
      .then((res) => {
        if (active) setStatus(res.data.integrations);
      })
      .catch(() => {
        // Status is best-effort; if it fails we simply show nothing rather
        // than alarming the user with a false outage.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!status) return null;

  const issues: string[] = [];
  if (!status.pinata) issues.push('IPFS deployments are paused');
  if (!status.pi) issues.push('Pi Network payments are unavailable');

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
