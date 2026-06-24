/**
 * Live Pi/USD price source (Phase 5).
 *
 * MASTER RULE: never fake a price. When no real source is configured, the
 * source is unknown, the request fails, the shape is invalid, or the price is
 * stale, this throws IntegrationUnavailableError so routes return an honest 503
 * and billing halts — it NEVER returns a guessed/hardcoded/cached fallback.
 *
 * PI_PRICE_SOURCE selects an allowlisted provider by KEY (e.g. "coingecko") —
 * never a raw URL — so the outbound request target is fixed in code and there
 * is no SSRF surface.
 */
import axios from 'axios';
import { logger } from '../utils/logger';
import { IntegrationUnavailableError } from '../utils/integrations';

export interface PiPrice {
  /** Pi price in USD (> 0). */
  piUsd: number;
  /** When the source last updated this price. */
  observedAt: Date;
  /** Provider the price came from (matches PI_PRICE_SOURCE). */
  source: string;
}

/** Max age a source price may be before we treat it as stale. */
const MAX_PRICE_AGE_SECONDS = 60 * 60; // 1 hour
const REQUEST_TIMEOUT_MS = 5000;
const INTEGRATION = 'pi-price';

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
};

/** True when a real, allowlisted price source is configured. */
export function isPiPriceConfigured(): boolean {
  const source = process.env.PI_PRICE_SOURCE?.trim();
  return Boolean(source && PROVIDERS[source]);
}

/**
 * Fetch the live Pi/USD price from the configured source, or throw
 * IntegrationUnavailableError (-> HTTP 503) if a trustworthy live price can't be
 * obtained. Never returns a fallback price.
 */
export async function getPiUsdPrice(): Promise<PiPrice> {
  const source = process.env.PI_PRICE_SOURCE?.trim();
  if (!source) {
    throw new IntegrationUnavailableError(INTEGRATION, 'Pi/USD price source is not configured.');
  }
  const provider = PROVIDERS[source];
  if (!provider) {
    throw new IntegrationUnavailableError(INTEGRATION, `Unknown Pi/USD price source "${source}".`);
  }

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
      error: err instanceof Error ? err.message : String(err),
    });
    throw new IntegrationUnavailableError(INTEGRATION, 'Could not retrieve a live Pi/USD price.');
  }

  const ageSeconds = (Date.now() - parsed.observedAt.getTime()) / 1000;
  if (ageSeconds > MAX_PRICE_AGE_SECONDS) {
    logger.error('Pi/USD price is stale', { source, ageSeconds });
    throw new IntegrationUnavailableError(
      INTEGRATION,
      'The latest Pi/USD price is stale; refusing to quote.',
    );
  }

  return { piUsd: parsed.piUsd, observedAt: parsed.observedAt, source };
}
