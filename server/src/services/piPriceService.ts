/**
 * Live Pi/USD price source (Phase 5) with ordered failover.
 *
 * MASTER RULE: never fake a price. When no real source is configured, a
 * source is unknown, every request fails, the shape is invalid, or the price
 * is stale, this throws IntegrationUnavailableError so routes return an honest
 * 503 and billing halts — it NEVER returns a guessed/hardcoded/cached fallback.
 *
 * PI_PRICE_SOURCE is a comma-separated, ORDERED list of allowlisted provider
 * KEYS (e.g. "coingecko,bitget") — never raw URLs — so every outbound request
 * target is fixed in code and there is no SSRF surface. Providers are tried in
 * order (failover, NOT averaging): the first one that yields a fresh, valid,
 * sane price wins, and its name is returned as `source` so quote records stay
 * accurate about where the rate came from. A single-entry list behaves exactly
 * like the original single-provider setup.
 */
import axios from 'axios';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';

export interface PiPrice {
  /** Pi price in USD (> 0). */
  piUsd: number;
  /** When the source last updated this price. */
  observedAt: Date;
  /** Provider the price ACTUALLY came from (one of PI_PRICE_SOURCE). */
  source: string;
}

/** Max age a source price may be before we treat it as stale. */
const MAX_PRICE_AGE_SECONDS = 60 * 60; // 1 hour
const REQUEST_TIMEOUT_MS = 5000;
const INTEGRATION = 'pi-price';

/**
 * Sanity guard: a BACKUP (non-primary) provider whose price deviates more than
 * this fraction from the last known good price is treated as suspect and
 * rejected. We prefer an honest 503 over charging a wild number.
 */
const MAX_BACKUP_DEVIATION = 0.2; // 20%

interface PriceProvider {
  url: string;
  parse: (data: unknown) => { piUsd: number; observedAt: Date };
}

const PROVIDERS: Record<string, PriceProvider> = {
  coingecko: {
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=pi-network&vs_currencies=usd&include_last_updated_at=true',
    parse: (data) => {
      const node = (data as Record<string, { usd?: unknown; last_updated_at?: unknown }>)?.[
        'pi-network'
      ];
      const piUsd = node?.usd;
      const updatedAt = node?.last_updated_at;
      if (typeof piUsd !== 'number' || !Number.isFinite(piUsd) || piUsd <= 0) {
        throw new Error('CoinGecko response is missing a valid pi-network USD price.');
      }
      // Freshness is a billing safety condition — never fabricate it. If the
      // source omits a usable timestamp we reject (caller -> honest 503) rather
      // than assume the price is current.
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        throw new Error('CoinGecko response is missing a valid last_updated_at timestamp.');
      }
      return { piUsd, observedAt: new Date(updatedAt * 1000) };
    },
  },
  /**
   * Bitget public spot ticker (no API key required). The pair is PI/USDT, not
   * PI/USD — USDT is a dollar-pegged stablecoin whose typical deviation from
   * USD is far smaller than the billing buffer, so it is acceptable for a
   * BACKUP source. The per-ticker `ts` field is the exchange's own update
   * timestamp, which we require for the staleness check (same rule as
   * CoinGecko: no usable timestamp -> reject, never assume fresh).
   */
  bitget: {
    url: 'https://api.bitget.com/api/v2/spot/market/tickers?symbol=PIUSDT',
    parse: (data) => {
      const body = data as { code?: unknown; data?: Array<{ lastPr?: unknown; ts?: unknown }> };
      if (body?.code !== '00000') {
        throw new Error('Bitget response did not report success.');
      }
      const ticker = Array.isArray(body.data) ? body.data[0] : undefined;
      const piUsd = typeof ticker?.lastPr === 'string' ? Number(ticker.lastPr) : NaN;
      const tsMs = typeof ticker?.ts === 'string' ? Number(ticker.ts) : NaN;
      if (!Number.isFinite(piUsd) || piUsd <= 0) {
        throw new Error('Bitget response is missing a valid PIUSDT last price.');
      }
      if (!Number.isFinite(tsMs) || tsMs <= 0) {
        throw new Error('Bitget response is missing a valid ticker timestamp.');
      }
      return { piUsd, observedAt: new Date(tsMs) };
    },
  },
};

/**
 * Last price we successfully served (from ANY provider). Used ONLY as a
 * reference for the backup-price sanity guard — it is never returned as a
 * price itself (that would be a cached fallback, which the master rule bans).
 */
let lastKnownGood: { piUsd: number; at: Date } | null = null;

/** Parse PI_PRICE_SOURCE as an ordered, comma-separated provider list. */
function configuredSources(): string[] {
  return (process.env.PI_PRICE_SOURCE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * True when a real price source is configured: a non-empty ordered list in
 * which EVERY key is allowlisted. A list containing an unknown key is a config
 * error and reports NOT configured (and getPiUsdPrice fails loudly on it)
 * rather than being silently narrowed to the recognized subset.
 */
export function isPiPriceConfigured(): boolean {
  const sources = configuredSources();
  return sources.length > 0 && sources.every((s) => Boolean(PROVIDERS[s]));
}

/**
 * Fetch the live Pi/USD price from the configured source(s), trying each in
 * order, or throw IntegrationUnavailableError (-> HTTP 503) if no trustworthy
 * live price can be obtained. Never returns a fallback price.
 */
export async function getPiUsdPrice(): Promise<PiPrice> {
  const sources = configuredSources();
  if (sources.length === 0) {
    throw new IntegrationUnavailableError(INTEGRATION, 'Pi/USD price source is not configured.');
  }
  // Unknown keys fail loudly (honest config error) — never silently skipped.
  const unknown = sources.find((s) => !PROVIDERS[s]);
  if (unknown !== undefined) {
    throw new IntegrationUnavailableError(
      INTEGRATION,
      `Unknown Pi/USD price source "${unknown}".`,
    );
  }

  let sawStale = false;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const provider = PROVIDERS[source];

    let parsed: { piUsd: number; observedAt: Date };
    try {
      const response = await axios.get(provider.url, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { accept: 'application/json' },
      });
      parsed = provider.parse(response.data);
    } catch (err) {
      logger.error('Pi/USD price lookup failed', {
        source,
        attempt: i + 1,
        of: sources.length,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const ageSeconds = (Date.now() - parsed.observedAt.getTime()) / 1000;
    if (ageSeconds > MAX_PRICE_AGE_SECONDS) {
      logger.error('Pi/USD price is stale', { source, ageSeconds });
      sawStale = true;
      continue;
    }

    // Sanity guard: only for NON-primary providers, and only when we have a
    // last known good price to compare against. A wild deviation means the
    // backup is suspect — reject it rather than charge a wild number.
    if (i > 0 && lastKnownGood) {
      const deviation = Math.abs(parsed.piUsd - lastKnownGood.piUsd) / lastKnownGood.piUsd;
      if (deviation > MAX_BACKUP_DEVIATION) {
        logger.error('Backup Pi/USD price deviates wildly from last known good — rejecting', {
          source,
          piUsd: parsed.piUsd,
          lastKnownGoodPiUsd: lastKnownGood.piUsd,
          lastKnownGoodAt: lastKnownGood.at.toISOString(),
          deviation,
          maxDeviation: MAX_BACKUP_DEVIATION,
        });
        continue;
      }
    }

    lastKnownGood = { piUsd: parsed.piUsd, at: new Date() };
    logger.info('Pi/USD price served', {
      source,
      piUsd: parsed.piUsd,
      observedAt: parsed.observedAt.toISOString(),
      failedOver: i > 0,
    });
    return { piUsd: parsed.piUsd, observedAt: parsed.observedAt, source };
  }

  // Every configured provider failed. Preserve the original single-provider
  // stale message where it applies; otherwise the generic honest 503.
  if (sawStale && sources.length === 1) {
    throw new IntegrationUnavailableError(
      INTEGRATION,
      'The latest Pi/USD price is stale; refusing to quote.',
    );
  }
  throw new IntegrationUnavailableError(
    INTEGRATION,
    'Could not retrieve a live Pi/USD price.',
  );
}
