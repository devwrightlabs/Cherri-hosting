/**
 * Watchdog API client — uptime/health monitor for hosted sites.
 *
 * Talks to:
 *   GET  /api/watchdog/summary              — summary for all authed user's deployments
 *   GET  /api/watchdog/:deploymentId        — incident timeline + recent checks
 *   POST /api/watchdog/:deploymentId/check  — manual re-check trigger
 */
import { apiClient } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WatchdogStatus = 'up' | 'down' | 'degraded' | 'unknown';

export interface WatchdogDeploymentSummary {
  deploymentId: string;
  projectName: string;
  url: string;
  status: WatchdogStatus;
  httpCode: number | null;
  responseTimeMs: number | null;
  lastCheckedAt: string | null;
  uptimePercent24h: number;
  hasOpenIncident: boolean;
  openIncidentSince: string | null;
}

export interface WatchdogSummaryResponse {
  monitoringDisabled: boolean;
  deployments: WatchdogDeploymentSummary[];
  error?: string;
}

export interface WatchdogIncident {
  id: string;
  deploymentId: string;
  url: string;
  openedAt: string;
  closedAt: string | null;
  reason: string;
}

export interface WatchdogCheck {
  id: string;
  status: WatchdogStatus;
  httpCode: number | null;
  responseTimeMs: number;
  checkedAt: string;
}

export interface WatchdogDetailResponse {
  monitoringDisabled: boolean;
  deploymentId: string;
  incidents: WatchdogIncident[];
  recentChecks: WatchdogCheck[];
  uptimePercent24h: number;
  error?: string;
}

export interface ManualCheckResponse {
  monitoringDisabled?: boolean;
  status?: WatchdogStatus;
  httpCode?: number | null;
  responseTimeMs?: number;
  checkedAt?: string;
  error?: string;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const watchdogApi = {
  /** Summary of all active deployments' uptime status. */
  summary: () =>
    apiClient.get<WatchdogSummaryResponse>('/watchdog/summary', { timeout: 15_000 }),

  /** Incident timeline + recent checks for a specific deployment. */
  incidents: (deploymentId: string) =>
    apiClient.get<WatchdogDetailResponse>(`/watchdog/${deploymentId}`, { timeout: 15_000 }),

  /** Trigger a manual re-check for a specific deployment. */
  recheck: (deploymentId: string) =>
    apiClient.post<ManualCheckResponse>(`/watchdog/${deploymentId}/check`, {}, { timeout: 20_000 }),
};
