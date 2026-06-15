/**
 * Pi environment — server-side single source of truth for which Pi Platform
 * API key to use. Mirrors the client `lib/piEnv.ts` type so the `env` value
 * threaded from the browser maps cleanly to a key here.
 */
export type PiEnv = 'testnet' | 'mainnet';

/** Coerce any untrusted input (request body, metadata) into a valid PiEnv. */
export function normalizePiEnv(value: unknown): PiEnv {
  return value === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * Resolve the Pi Platform API key for an environment.
 *
 * - testnet: `PI_API_KEY_TESTNET`, falling back to the legacy single
 *   `PI_API_KEY` so existing deployments keep working.
 * - mainnet: `PI_API_KEY_MAINNET` ONLY. It NEVER falls back to the testnet
 *   key — a misconfigured mainnet must fail loudly rather than silently
 *   process real Pi with a sandbox key.
 *
 * Returns `undefined` when no key is configured; callers must refuse the
 * request (honest 503) rather than continue.
 */
export function serverKeyFor(env: PiEnv): string | undefined {
  if (env === 'mainnet') {
    return process.env.PI_API_KEY_MAINNET || undefined;
  }
  return process.env.PI_API_KEY_TESTNET || process.env.PI_API_KEY || undefined;
}
