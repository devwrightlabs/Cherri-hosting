/**
 * Railway unit-cost FACTS (WOODSTICK 3 Phase 1) used only to compute a clearly
 * labeled cost ESTIMATE for the operator dashboard. These are list-price
 * approximations, env-overridable, and never presented as an actual bill — the
 * authoritative spend lives in the operator's Railway account.
 */

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface RailwayUnitCostsUsd {
  vcpuPerMonth: number;
  ramGbPerMonth: number;
  volumeGbPerMonth: number;
  egressPerGb: number;
}

/** Current unit costs (env-overridable), defaulting to Railway list prices. */
export function getRailwayUnitCosts(): RailwayUnitCostsUsd {
  return {
    vcpuPerMonth: num(process.env.RAILWAY_USD_PER_VCPU_MONTH, 20),
    ramGbPerMonth: num(process.env.RAILWAY_USD_PER_GB_RAM_MONTH, 10),
    volumeGbPerMonth: num(process.env.RAILWAY_USD_PER_GB_VOLUME_MONTH, 0.25),
    // Egress lists at $0.05-0.10/GB; default to the high end (conservative for
    // cost-exposure awareness).
    egressPerGb: num(process.env.RAILWAY_USD_PER_GB_EGRESS, 0.1),
  };
}

export interface UsageMeasurement {
  measurement: string;
  estimatedValue: number;
}

export interface CostEstimate {
  totalUsd: number;
  breakdown: Record<string, number>;
  assumptions: string;
}

/**
 * Turn Railway current-period `estimatedUsage` measurements into a rough monthly
 * USD estimate. Only billable measurements are priced; limits and inbound
 * (RX) network are ignored. The result is explicitly an estimate, not a bill.
 */
export function estimateMonthlyUsdFromUsage(
  usage: UsageMeasurement[],
  costs: RailwayUnitCostsUsd = getRailwayUnitCosts(),
): CostEstimate {
  const breakdown: Record<string, number> = {};
  for (const u of usage) {
    const v = Number(u.estimatedValue) || 0;
    switch (u.measurement) {
      case 'CPU_USAGE':
        breakdown[u.measurement] = v * costs.vcpuPerMonth;
        break;
      case 'MEMORY_USAGE_GB':
        breakdown[u.measurement] = v * costs.ramGbPerMonth;
        break;
      case 'DISK_USAGE_GB':
      case 'BACKUP_USAGE_GB':
        breakdown[u.measurement] = v * costs.volumeGbPerMonth;
        break;
      case 'NETWORK_TX_GB':
        breakdown[u.measurement] = v * costs.egressPerGb;
        break;
      default:
        break; // RX / *_LIMIT measurements are not billed here
    }
  }
  const totalUsd =
    Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0) * 100) / 100;
  return {
    totalUsd,
    breakdown,
    assumptions:
      'Estimate = Railway current-period usage projection x operator unit-cost facts. Not an invoice.',
  };
}
