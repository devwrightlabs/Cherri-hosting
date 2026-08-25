/**
 * Cherri Watchdog Dashboard Widget
 *
 * Shows per-site up/down status, uptime %, last response time, and recent
 * incidents for all of the authenticated user's ACTIVE deployments.
 *
 * Design tokens: obsidian #0A0A0F / gold #F0C040 from the governance design system.
 * Uses the real /api/watchdog/summary endpoint — no mocks.
 * Degrades gracefully when monitoring is disabled (DB absent) or on API error.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  watchdogApi,
  WatchdogDeploymentSummary,
  WatchdogStatus,
} from '../../api/watchdogApi';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: WatchdogStatus): string {
  switch (status) {
    case 'up':       return 'bg-live';
    case 'degraded': return 'bg-amber-400';
    case 'down':     return 'bg-red-500';
    default:         return 'bg-surface-2';
  }
}

function statusLabel(status: WatchdogStatus): string {
  switch (status) {
    case 'up':       return 'UP';
    case 'degraded': return 'DEGRADED';
    case 'down':     return 'DOWN';
    default:         return 'UNKNOWN';
  }
}

function statusTextColor(status: WatchdogStatus): string {
  switch (status) {
    case 'up':       return 'text-live';
    case 'degraded': return 'text-amber-400';
    case 'down':     return 'text-red-400';
    default:         return 'text-text-mut';
  }
}

function formatUptime(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function truncUrl(url: string, max = 40): string {
  try {
    const u = new URL(url);
    const host = u.hostname;
    return host.length > max ? `${host.slice(0, max - 3)}…` : host;
  } catch {
    return url.length > max ? `${url.slice(0, max - 3)}…` : url;
  }
}

// ─── Single deployment row ────────────────────────────────────────────────────

interface DeploymentRowProps {
  dep: WatchdogDeploymentSummary;
  onRecheck: (id: string) => void;
  recheckingId: string | null;
}

function DeploymentRow({ dep, onRecheck, recheckingId }: DeploymentRowProps) {
  const isRechecking = recheckingId === dep.deploymentId;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface hover:bg-surface-2 transition-colors">
      {/* Status dot */}
      <span
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusColor(dep.status)} ${dep.status === 'up' ? 'shadow-[0_0_6px_rgba(16,185,129,0.6)]' : ''}`}
        aria-label={`Status: ${statusLabel(dep.status)}`}
      />

      {/* Site name + URL */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text truncate">{dep.projectName}</p>
        <p className="text-xs text-text-mut truncate">{truncUrl(dep.url)}</p>
      </div>

      {/* Status label */}
      <span className={`text-xs font-mono font-semibold ${statusTextColor(dep.status)} w-16 text-right`}>
        {statusLabel(dep.status)}
      </span>

      {/* Uptime % */}
      <div className="text-right hidden sm:block w-16">
        <p className="text-xs font-mono text-gold">{formatUptime(dep.uptimePercent24h)}</p>
        <p className="text-[10px] text-text-mut">24h uptime</p>
      </div>

      {/* Response time */}
      <div className="text-right hidden md:block w-14">
        <p className="text-xs font-mono text-text-mut">{formatMs(dep.responseTimeMs)}</p>
        <p className="text-[10px] text-text-mut">{relTime(dep.lastCheckedAt)}</p>
      </div>

      {/* Incident badge */}
      {dep.hasOpenIncident && (
        <span className="bg-red-500/20 text-red-400 text-[10px] font-semibold px-1.5 py-0.5 rounded hidden sm:inline">
          INCIDENT
        </span>
      )}

      {/* Manual recheck */}
      <button
        onClick={() => onRecheck(dep.deploymentId)}
        disabled={isRechecking}
        className="text-[10px] text-text-mut hover:text-gold transition-colors disabled:opacity-40 flex-shrink-0"
        title="Re-check now"
        aria-label="Manual re-check"
      >
        {isRechecking ? (
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export default function WatchdogWidget() {
  const [deployments, setDeployments] = useState<WatchdogDeploymentSummary[]>([]);
  const [monitoringDisabled, setMonitoringDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [recheckFeedback, setRecheckFeedback] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setError('');
    watchdogApi
      .summary()
      .then((res) => {
        if (res.data.monitoringDisabled) {
          setMonitoringDisabled(true);
          setDeployments([]);
        } else {
          setMonitoringDisabled(false);
          setDeployments(res.data.deployments ?? []);
        }
      })
      .catch(() => setError('Could not load monitoring data.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // Refresh every 60 s
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRecheck = useCallback(async (deploymentId: string) => {
    setRecheckingId(deploymentId);
    setRecheckFeedback((prev) => ({ ...prev, [deploymentId]: '' }));
    try {
      const res = await watchdogApi.recheck(deploymentId);
      const d = res.data;
      if (d.monitoringDisabled) {
        setRecheckFeedback((prev) => ({ ...prev, [deploymentId]: 'monitoring disabled' }));
      } else if (d.error) {
        setRecheckFeedback((prev) => ({ ...prev, [deploymentId]: d.error! }));
      } else {
        // Optimistically update the row
        setDeployments((prev) =>
          prev.map((dep) =>
            dep.deploymentId === deploymentId
              ? {
                  ...dep,
                  status: (d.status ?? dep.status) as WatchdogStatus,
                  httpCode: d.httpCode ?? dep.httpCode,
                  responseTimeMs: d.responseTimeMs ?? dep.responseTimeMs,
                  lastCheckedAt: d.checkedAt ?? dep.lastCheckedAt,
                }
              : dep,
          ),
        );
        setRecheckFeedback((prev) => ({ ...prev, [deploymentId]: '' }));
      }
    } catch {
      setRecheckFeedback((prev) => ({ ...prev, [deploymentId]: 'check failed' }));
    } finally {
      setRecheckingId(null);
    }
  }, []);

  const allUp    = deployments.length > 0 && deployments.every((d) => d.status === 'up');
  const anyDown  = deployments.some((d) => d.status === 'down');
  const anyDeg   = deployments.some((d) => d.status === 'degraded');

  // ─── States ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-gold animate-pulse" />
          <h2 className="text-sm font-semibold text-text">Cherri Watchdog</h2>
        </div>
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (monitoringDisabled) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text mb-1 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-text-mut" />
          Cherri Watchdog
        </h2>
        <p className="text-xs text-text-mut">
          Uptime monitoring is not available — the database is not connected.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text mb-1">Cherri Watchdog</h2>
        <p className="text-xs text-red-400">{error}</p>
        <button onClick={load} className="mt-2 text-xs text-gold hover:underline">Retry</button>
      </section>
    );
  }

  if (deployments.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text mb-1 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-text-mut" />
          Cherri Watchdog
        </h2>
        <p className="text-xs text-text-mut">
          No active deployments to monitor. Deploy a site to see uptime metrics here.
        </p>
      </section>
    );
  }

  // ─── Main render ─────────────────────────────────────────────────────────

  const overallStatus = anyDown ? 'down' : anyDeg ? 'degraded' : allUp ? 'up' : 'unknown';
  const overallLabel  = anyDown ? 'Outage detected' : anyDeg ? 'Degraded' : allUp ? 'All systems operational' : 'Monitoring';

  return (
    <section className="rounded-xl border border-border bg-surface overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${statusColor(overallStatus)} ${overallStatus === 'up' ? 'animate-pulse' : ''}`}
            aria-hidden
          />
          <h2 className="text-sm font-semibold text-text">Cherri Watchdog</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${statusTextColor(overallStatus)}`}>
            {overallLabel}
          </span>
          <button
            onClick={load}
            className="text-text-mut hover:text-gold transition-colors"
            title="Refresh"
            aria-label="Refresh watchdog data"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Deployment rows */}
      <div className="divide-y divide-border/40">
        {deployments.map((dep) => (
          <div key={dep.deploymentId}>
            <DeploymentRow
              dep={dep}
              onRecheck={handleRecheck}
              recheckingId={recheckingId}
            />
            {recheckFeedback[dep.deploymentId] && (
              <p className="px-4 pb-2 text-[10px] text-red-400">{recheckFeedback[dep.deploymentId]}</p>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border/40 flex items-center justify-between">
        <p className="text-[10px] text-text-mut">
          {deployments.length} site{deployments.length !== 1 ? 's' : ''} monitored · auto-refreshes every 60s
        </p>
        <p className="text-[10px] text-text-mut">
          Checks every 60s
        </p>
      </div>
    </section>
  );
}
