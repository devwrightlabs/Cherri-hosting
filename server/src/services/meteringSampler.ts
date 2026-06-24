/**
 * Phase 4 metering sampler loop. Periodically appends a UsageSample for every
 * ACTIVE provisioned backend from REAL Railway network usage.
 *
 * The sampling itself self-skips when the metering capability is off or Railway
 * is unconfigured (see meteringService.sampleAllUsage), so the loop is an honest
 * no-op until the operator flips GO-LIVE and metering's keys are present. Mirrors
 * the dormancy reconciler: errors are isolated, the timer is unref'd so it never
 * keeps the process alive on its own.
 */
import { logger } from '../utils/logger';
import { sampleAllUsage } from './meteringService';

const TICK_MS = Number(process.env.METERING_TICK_MS ?? 3_600_000); // hourly

export async function runMeteringTick(): Promise<void> {
  const result = await sampleAllUsage();
  if (result.attempted > 0) {
    logger.info('Metering sampler tick', result);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startMeteringSampler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runMeteringTick().catch((err) =>
      logger.error('Metering sampler tick failed', {
        error: (err as Error).message,
      }),
    );
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info('Metering sampler started', { tickMs: TICK_MS });
}

export function stopMeteringSampler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
