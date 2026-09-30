import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import Spinner from '../components/ui/Spinner';
import { getEnv, sandboxFor, type PiEnv } from '../lib/piEnv';

type SDKState = 'idle' | 'loading' | 'ready' | 'error';

interface PiSDKContextValue {
  state: SDKState;
  retry: () => void;
  /** Re-run Pi.init() under a new env's sandbox flag (used by the TEST|LIVE switch). */
  reinit: (env: PiEnv) => Promise<void>;
}

const PiSDKContext = createContext<PiSDKContextValue | null>(null);

const MAX_RETRIES = 5;
const TIMEOUT_MS = 10_000;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

function loadPiSDKScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Fast path: client/index.html loads the foundation SDK statically in
    // <head> (a real <script> tag in the served HTML, not JS-injected) so
    // window.Pi is normally already present by the time this runs. Only fall
    // back to dynamic injection/retry below for the rare case it hasn't
    // finished loading yet (slow network, flaky Pi Browser webview).
    if (window.Pi) {
      resolve();
      return;
    }

    const existing = document.getElementById('pi-sdk-script');
    if (existing) {
      if (window.Pi) {
        resolve();
        return;
      }
      // Script tag exists but Pi not ready yet – remove & retry fresh
      existing.remove();
    }

    const timer = setTimeout(
      () => reject(new Error('Pi SDK load timeout')),
      TIMEOUT_MS,
    );

    const script = document.createElement('script');
    script.id = 'pi-sdk-script';
    script.src = 'https://sdk.minepi.com/pi-sdk.js';
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Failed to load Pi SDK script'));
    };
    document.head.appendChild(script);
  });
}

async function initWithRetry(attempt = 0): Promise<void> {
  try {
    await loadPiSDKScript();
    // Pi.init() may return a Promise — always await it so authentication
    // never starts before initialisation fully completes.
    await Promise.resolve(
      window.Pi!.init({
        version: '2.0',
        sandbox: sandboxFor(getEnv()),
      }),
    );
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, attempt), MAX_RETRY_DELAY_MS);
      await new Promise((r) => setTimeout(r, delay));
      return initWithRetry(attempt + 1);
    }
    throw err;
  }
}

export function PiSDKProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SDKState>('idle');
  const initRef = useRef(false);

  const init = useCallback(async () => {
    if (initRef.current) return;
    initRef.current = true;
    setState('loading');

    try {
      await initWithRetry();
      setState('ready');
    } catch {
      setState('error');
      initRef.current = false;
    }
  }, []);

  const retry = useCallback(() => {
    initRef.current = false;
    void init();
  }, [init]);

  const reinit = useCallback(async (env: PiEnv) => {
    if (!window.Pi) throw new Error('Pi SDK not ready');
    await Promise.resolve(
      window.Pi.init({ version: '2.0', sandbox: sandboxFor(env) }),
    );
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-surface-950 flex flex-col items-center justify-center gap-4">
        <div className="text-4xl">🌐</div>
        <Spinner size="lg" />
        <p className="text-surface-600 text-sm">Initializing Pi SDK…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen bg-surface-950 flex flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="text-5xl">🌐</div>
        <h2 className="text-xl font-semibold text-ink">
          Could not reach Pi Network
        </h2>
        <p className="text-surface-600 max-w-sm text-sm">
          The Pi SDK failed to load. Please check your connection or open this
          app inside the Pi Browser.
        </p>
        <button
          onClick={retry}
          className="px-6 py-2 bg-cherry-gradient rounded-lg text-surface-950 font-semibold hover:opacity-90 transition-opacity"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <PiSDKContext.Provider value={{ state, retry, reinit }}>
      {children}
    </PiSDKContext.Provider>
  );
}

export function usePiSDK(): PiSDKContextValue {
  const ctx = useContext(PiSDKContext);
  if (!ctx) throw new Error('usePiSDK must be used within PiSDKProvider');
  return ctx;
}
