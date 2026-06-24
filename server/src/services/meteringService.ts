/**
 * Phase 4 metering — REAL network-egress sampling + closed-cycle overage.
 *
 * Honesty guarantees (WOODSTICK 3 master rules):
 *   - Usage is only ever recorded from a real, observed Railway `estimatedUsage`
 *     reading. A provider that is unconfigured/unreachable yields NO sample — we
 *     never fabricate a usage figure.
 *   - Overage is computed from samples that fall inside the closed billing cycle
 *     only, via reset-aware positive deltas (a cumulative value dropping means
 *     the provider's billing period reset, not negative usage).
 *   - When the metering capability is off, or there aren't enough samples to
 *     compute a delta, overage is 0 tagged METERING_UNAVAILABLE — never a guess.
 *   - Cents are rounded UP (ceil) so a partial GB is never silently dropped, but
 *     we still never charge for GB we did not actually observe.
 *
 * This module performs no charging. It records the ledger and computes the debt;
 * the actual Pi settlement remains the deferred GO-LIVE cutover.
 */
import { prisma } from '../utils/prismaClient';
import { logger } from '../utils/logger';
import {
  includedNetworkGb,
  METERING_OVERAGE_CENTS_PER_GB,
} from '../utils/pricingCatalog';
import { isCapabilityEnabled } from './goLiveService';
import { ACTIVITY_SOURCE } from './dbDormancyService';
import { isRailwayConfigured, getEstimatedUsage } from './railway';

export interface OverageResult {
  cents: number;
  source: string;
}

export interface CycleUsage {
  available: boolean;
  networkGb: number;
  samples: number;
  reason?: string;
}

export interface SampleRunResult {
  attempted: number;
  written: number;
  skipped: number;
}

/**
 * Reset-aware consumed total from a series of cumulative readings. Each step adds
 * the positive delta; when a reading drops below the previous one the provider's
 * billing period reset, so the new reading is counted from zero — never a
 * negative delta. Fewer than two readings means no measurable consumption (0).
 */
export function consumedFromReadings(readings: number[]): number {
  let consumed = 0;
  for (let i = 1; i < readings.length; i++) {
    const prev = readings[i - 1];
    const curr = readings[i];
    consumed += curr >= prev ? curr - prev : curr;
  }
  return consumed;
}

/**
 * Integer cents owed for `totalGb` against an `includedGb` allowance. Rounded UP
 * (ceil) so a partial overage GB is never silently dropped, but floored at 0 so
 * usage under the allowance is never charged and we never invent usage.
 */
export function overageCents(
  totalGb: number,
  includedGb: number,
  ratePerGb: number = METERING_OVERAGE_CENTS_PER_GB,
): number {
  const overageGb = Math.max(0, totalGb - includedGb);
  return Math.ceil(overageGb * ratePerGb);
}

/**
 * Consumed network egress (GB) for one backend service across a closed cycle,
 * from sampled cumulative readings via reset-aware positive deltas. Requires at
 * least two in-cycle samples to form a delta; otherwise it's UNAVAILABLE (we
 * only ever charge for usage we actually observed inside the window).
 */
export async function computeCycleNetworkGb(
  backendServiceId: string,
  cycleStart: Date,
  cycleEnd: Date,
): Promise<CycleUsage> {
  const samples = await prisma.usageSample.findMany({
    where: { backendServiceId, sampledAt: { gte: cycleStart, lte: cycleEnd } },
    orderBy: { sampledAt: 'asc' },
    select: { networkGb: true },
  });

  if (samples.length < 2) {
    return {
      available: false,
      networkGb: 0,
      samples: samples.length,
      reason: 'insufficient in-cycle samples to compute a delta',
    };
  }

  const networkGb = consumedFromReadings(samples.map((s) => s.networkGb));
  return { available: true, networkGb, samples: samples.length };
}

/**
 * Aggregate closed-cycle overage for a user across all their backend services.
 * Returns 0 / METERING_UNAVAILABLE when metering is off or no service produced
 * enough samples; METERING_PARTIAL when some (not all) services had usable data.
 */
export async function computeOverageForUser(args: {
  userId: string;
  plan: string;
  cycleStart: Date;
  cycleEnd: Date;
}): Promise<OverageResult> {
  if (!(await isCapabilityEnabled('metering'))) {
    return { cents: 0, source: 'METERING_UNAVAILABLE' };
  }

  const services = await prisma.backendService.findMany({
    where: { project: { userId: args.userId } },
    select: { id: true },
  });
  if (services.length === 0) {
    return { cents: 0, source: 'METERING_NO_BACKEND' };
  }

  let totalGb = 0;
  let anyAvailable = false;
  let allAvailable = true;
  for (const s of services) {
    const usage = await computeCycleNetworkGb(s.id, args.cycleStart, args.cycleEnd);
    if (usage.available) {
      totalGb += usage.networkGb;
      anyAvailable = true;
    } else {
      allAvailable = false;
    }
  }

  if (!anyAvailable) {
    return { cents: 0, source: 'METERING_UNAVAILABLE' };
  }

  const cents = overageCents(totalGb, includedNetworkGb(args.plan));
  return {
    cents,
    source: allAvailable ? 'METERING_RAILWAY_NETWORK' : 'METERING_PARTIAL',
  };
}

/**
 * Poll Railway network usage for every ACTIVE provisioned backend and append a
 * UsageSample. Self-guards: returns an empty run when the metering capability is
 * off or Railway is unconfigured. A per-service provider error writes NO sample
 * (honest) and is isolated so one failure can't abort the sweep.
 */
export async function sampleAllUsage(): Promise<SampleRunResult> {
  if (!(await isCapabilityEnabled('metering')) || !isRailwayConfigured()) {
    return { attempted: 0, written: 0, skipped: 0 };
  }

  const services = await prisma.backendService.findMany({
    where: { railwayProjectId: { not: null }, status: 'ACTIVE' },
    select: { id: true, railwayProjectId: true },
  });

  let written = 0;
  let skipped = 0;
  for (const s of services) {
    try {
      const usage = await getEstimatedUsage({
        projectId: s.railwayProjectId!,
        measurements: ['NETWORK_RX_GB', 'NETWORK_TX_GB'],
      });
      const networkGb = usage.reduce((a, u) => a + (Number(u.estimatedValue) || 0), 0);
      await prisma.usageSample.create({
        data: { backendServiceId: s.id, source: ACTIVITY_SOURCE, networkGb },
      });
      written++;
    } catch (err) {
      // Provider unreachable -> record NOTHING; we never fabricate a reading.
      skipped++;
      logger.warn('Metering: usage sample failed', {
        serviceId: s.id,
        error: (err as Error).message,
      });
    }
  }

  return { attempted: services.length, written, skipped };
}
