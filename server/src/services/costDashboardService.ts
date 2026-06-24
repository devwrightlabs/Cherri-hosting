/**
 * Phase 7 operator cost dashboard. Aggregates honest cost-exposure facts:
 *   - live/dormant DB counts and the hard-cap status from OUR records (always
 *     available, even when Railway is unreachable),
 *   - a clearly-labeled monthly spend ESTIMATE per provisioned app from Railway
 *     `estimatedUsage` x unit-cost facts.
 *
 * Honesty: when Railway is unconfigured or unreachable we say so and return null
 * estimates — we never invent spend numbers. This data is operator-only; it is
 * mounted behind requireOperator and never exposed to end users.
 */
import { prisma } from '../utils/prismaClient';
import { getCapStatus, countLiveDbs, CapStatus } from './costControlService';
import {
  isRailwayConfigured,
  getConnectionStatus,
  getEstimatedUsage,
  RailwayApiError,
  RailwayMeasurement,
} from './railway';
import {
  estimateMonthlyUsdFromUsage,
  getRailwayUnitCosts,
  RailwayUnitCostsUsd,
} from '../utils/railwayCostFacts';
import { logger } from '../utils/logger';

const COST_MEASUREMENTS: RailwayMeasurement[] = [
  'CPU_USAGE',
  'MEMORY_USAGE_GB',
  'DISK_USAGE_GB',
  'NETWORK_TX_GB',
  'NETWORK_RX_GB',
];

const DORMANT_STATUSES = [
  'DORMANT_PENDING',
  'SNAPSHOT_PENDING',
  'SNAPSHOTTED',
  'DELETE_PENDING',
];

interface DashboardAppCost {
  backendServiceId: string;
  app: string;
  estimatedMonthlyUsd: number | null;
  breakdown?: Record<string, number>;
  error?: string;
}

interface DashboardRailway {
  configured: boolean;
  reachable: boolean;
  reason?: string;
  partial?: boolean;
  estimatedMonthlyUsd: number | null;
  apps: DashboardAppCost[];
}

export interface CostDashboard {
  cap: CapStatus;
  counts: {
    liveDbs: number;
    dormantDbs: number;
    provisionedServices: number;
    totalApps: number;
  };
  unitCosts: RailwayUnitCostsUsd;
  railway: DashboardRailway;
  note: string;
}

export async function getCostDashboard(): Promise<CostDashboard> {
  const [cap, liveDbs, dormantDbs, provisionedServices, totalApps] =
    await Promise.all([
      getCapStatus(),
      countLiveDbs(),
      prisma.backendService.count({
        where: { dbLifecycleStatus: { in: DORMANT_STATUSES } },
      }),
      prisma.backendService.count({
        where: { railwayProjectId: { not: null } },
      }),
      prisma.project.count(),
    ]);

  const railway = await buildRailwaySection();

  return {
    cap,
    counts: { liveDbs, dormantDbs, provisionedServices, totalApps },
    unitCosts: getRailwayUnitCosts(),
    railway,
    note: 'Monthly figures are ESTIMATES from Railway current-period usage projections x operator unit-cost facts — not an invoice.',
  };
}

async function buildRailwaySection(): Promise<DashboardRailway> {
  if (!isRailwayConfigured()) {
    return {
      configured: false,
      reachable: false,
      reason: 'RAILWAY_API_TOKEN not set',
      estimatedMonthlyUsd: null,
      apps: [],
    };
  }

  const conn = await getConnectionStatus();
  if (!conn.reachable) {
    return {
      configured: true,
      reachable: false,
      reason: conn.reason ?? 'Railway unreachable',
      estimatedMonthlyUsd: null,
      apps: [],
    };
  }

  const services = await prisma.backendService.findMany({
    where: { railwayProjectId: { not: null } },
    select: {
      id: true,
      railwayProjectId: true,
      project: { select: { name: true } },
    },
  });

  const apps: DashboardAppCost[] = [];
  let total = 0;
  let partial = false;

  for (const s of services) {
    try {
      const usage = await getEstimatedUsage({
        projectId: s.railwayProjectId!,
        measurements: COST_MEASUREMENTS,
      });
      const est = estimateMonthlyUsdFromUsage(usage);
      total += est.totalUsd;
      apps.push({
        backendServiceId: s.id,
        app: s.project?.name ?? 'unknown',
        estimatedMonthlyUsd: est.totalUsd,
        breakdown: est.breakdown,
      });
    } catch (err) {
      partial = true;
      const message =
        err instanceof RailwayApiError ? err.message : 'usage unavailable';
      logger.warn('Cost dashboard: usage fetch failed', {
        backendServiceId: s.id,
        error: (err as Error).message,
      });
      apps.push({
        backendServiceId: s.id,
        app: s.project?.name ?? 'unknown',
        estimatedMonthlyUsd: null,
        error: message,
      });
    }
  }

  // Highest estimated spend first (null/errored apps sink to the bottom).
  apps.sort(
    (a, b) => (b.estimatedMonthlyUsd ?? -1) - (a.estimatedMonthlyUsd ?? -1),
  );

  return {
    configured: true,
    reachable: true,
    partial,
    estimatedMonthlyUsd: Math.round(total * 100) / 100,
    apps,
  };
}
