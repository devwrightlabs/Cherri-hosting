import { useSyncExternalStore } from 'react';

/**
 * Pi environment — the single source of truth for whether the app talks to the
 * Pi *testnet* (sandbox) or *mainnet* (real Pi). Kept OUTSIDE the auth/SDK
 * providers as a tiny external store so non-React modules (the SDK init path)
 * can read it synchronously and components can subscribe reactively.
 */
export type PiEnv = 'testnet' | 'mainnet';

const STORAGE_KEY = 'pi_env';
const COOKIE_NAME = 'pi_env';

/**
 * Mainnet is only real once a Pi *mainnet* app registration + server key exist.
 * Until then this stays false so LIVE is honestly gated — the toggle refuses to
 * switch AND the app refuses to boot into mainnet even if a stale value is left
 * in localStorage / cookie / VITE_PI_ENV. Flip via VITE_PI_MAINNET_ENABLED=true
 * only after mainnet is genuinely wired.
 */
export const MAINNET_ENABLED: boolean =
  import.meta.env.VITE_PI_MAINNET_ENABLED === 'true';

function readCookie(): PiEnv | null {
  try {
    const match = document.cookie.match(/(?:^|;\s*)pi_env=([^;]*)/);
    const val = match?.[1];
    if (val === 'testnet' || val === 'mainnet') return val;
  } catch {
    /* cookies unavailable */
  }
  return null;
}

function writeCookie(env: PiEnv): void {
  try {
    document.cookie = `${COOKIE_NAME}=${env};path=/;max-age=31536000;samesite=lax`;
  } catch {
    /* ignore */
  }
}

function readInitial(): PiEnv {
  // Honesty guard: never boot into mainnet while it is not genuinely enabled,
  // regardless of any persisted or build-time preference.
  if (!MAINNET_ENABLED) return 'testnet';
  // Cookie takes priority over localStorage (reload-safe after cookie-first switch).
  const fromCookie = readCookie();
  if (fromCookie) return fromCookie;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'testnet' || stored === 'mainnet') return stored;
  } catch {
    /* localStorage unavailable — fall through to env default */
  }
  return import.meta.env.VITE_PI_ENV === 'mainnet' ? 'mainnet' : 'testnet';
}

/** Default env at boot (MAINNET_ENABLED gate → cookie → localStorage → VITE_PI_ENV → testnet). */
export const DEFAULT_PI_ENV: PiEnv = readInitial();

/** Whether to render the TEST|LIVE control at all (hide via VITE_ALLOW_ENV_TOGGLE=false). */
export const ALLOW_ENV_TOGGLE: boolean =
  import.meta.env.VITE_ALLOW_ENV_TOGGLE !== 'false';

/** Pi SDK `sandbox` flag for a given env — mainnet is the only non-sandbox case. */
export const sandboxFor = (env: PiEnv): boolean => env !== 'mainnet';

let current: PiEnv = DEFAULT_PI_ENV;
const listeners = new Set<() => void>();

/** Synchronous read — safe to call from non-React code (e.g. SDK init). */
export function getEnv(): PiEnv {
  return current;
}

/** Update the env, persist it (localStorage + cookie), and notify subscribers. No-op if unchanged. */
export function setEnv(next: PiEnv): void {
  // Honesty guard: refuse to enter mainnet unless it is genuinely enabled.
  if (next === 'mainnet' && !MAINNET_ENABLED) return;
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore persistence failures */
  }
  writeCookie(next);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive hook — re-renders the component whenever the env changes. */
export function usePiEnv(): PiEnv {
  return useSyncExternalStore(subscribe, getEnv, () => DEFAULT_PI_ENV);
}
