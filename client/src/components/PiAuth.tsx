import { useState, useCallback, useRef, useEffect } from 'react';
import { usePiSDK } from '../providers/PiSDKProvider';
import { usePiAuth } from '../hooks/usePiAuth';
import Button from './ui/Button';
import Spinner from './ui/Spinner';

/**
 * Watchdog timeout (ms) on the Pi.authenticate() call itself.
 * If the callback never resolves (dropped callback, frozen Pi Browser modal,
 * etc.) we surface a recoverable error instead of leaving the user on a
 * permanently-spinning / blank screen.
 */
const AUTH_TIMEOUT_MS = 30_000;

export interface PiAuthProps {
  /** Called after a successful sign-in + backend token exchange. */
  onSuccess?: () => void;
  /** Extra Tailwind classes applied to the root element. */
  className?: string;
}

/**
 * PiAuth
 *
 * A self-contained, fail-safe Pi Network authentication widget.
 *
 * Fail-safe strategy (does NOT rely solely on React Error Boundaries):
 *  1. SDK state machine (PiSDKProvider) retries script loading with exponential
 *     back-off and renders a recoverable error UI — not a blank screen.
 *  2. A watchdog timer cancels a stale authenticate() promise so the component
 *     never hangs indefinitely waiting for a callback that will never fire.
 *  3. Every error path exposes a "Retry" control so the user can recover
 *     without a full page reload.
 *  4. An `isMounted` guard prevents setState calls after unmount.
 */
export default function PiAuth({ onSuccess, className = '' }: PiAuthProps) {
  const { state: sdkState, retry: retrySDK } = usePiSDK();
  const { isAuthenticated, isLoading, error: authError, signIn, signOut } = usePiAuth();

  const [timedOut, setTimedOut] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isMounted = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const clearWatchdog = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const handleSignIn = useCallback(async () => {
    if (sdkState !== 'ready' || isLoading) return;

    setTimedOut(false);
    setLocalError(null);

    // Watchdog: surface a recoverable error if authenticate() never settles.
    timeoutRef.current = setTimeout(() => {
      if (isMounted.current) {
        setTimedOut(true);
      }
    }, AUTH_TIMEOUT_MS);

    try {
      await signIn();
      if (isMounted.current && onSuccess) onSuccess();
    } catch (err) {
      if (isMounted.current) {
        setLocalError(err instanceof Error ? err.message : 'Authentication failed');
      }
    } finally {
      clearWatchdog();
    }
  }, [sdkState, isLoading, signIn, onSuccess, clearWatchdog]);

  const handleRetry = useCallback(() => {
    setTimedOut(false);
    setLocalError(null);
    if (sdkState === 'error') {
      retrySDK();
    } else {
      void handleSignIn();
    }
  }, [sdkState, retrySDK, handleSignIn]);

  // ── SDK loading ──────────────────────────────────────────────────────────────
  if (sdkState === 'loading') {
    return (
      <div className={`flex flex-col items-center gap-3 ${className}`}>
        <Spinner size="md" />
        <p className="text-surface-400 text-sm">Connecting to Pi Network…</p>
      </div>
    );
  }

  // ── SDK failed to load (retryable, never a blank screen) ─────────────────────
  if (sdkState === 'error') {
    return (
      <div className={`flex flex-col items-center gap-4 text-center ${className}`}>
        <p className="text-red-400 text-sm">
          Could not load the Pi SDK. Check your connection or open this app
          inside the Pi Browser.
        </p>
        <Button variant="secondary" size="sm" onClick={retrySDK}>
          Retry connection
        </Button>
      </div>
    );
  }

  // ── Auth callback timed out (retryable, no page reload required) ─────────────
  if (timedOut) {
    return (
      <div className={`flex flex-col items-center gap-4 text-center ${className}`}>
        <p className="text-surface-400 text-sm">
          Pi authentication is taking longer than expected. The Pi Browser
          window may have closed silently.
        </p>
        <Button variant="secondary" size="sm" onClick={handleRetry}>
          Try again
        </Button>
      </div>
    );
  }

  // ── Already authenticated ────────────────────────────────────────────────────
  if (isAuthenticated) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <span className="text-surface-400 text-sm">Signed in with Pi ✓</span>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    );
  }

  // ── Default: sign-in prompt ──────────────────────────────────────────────────
  const displayError = authError ?? localError;

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <Button
        onClick={handleSignIn}
        isLoading={isLoading}
        disabled={sdkState !== 'ready' || isLoading}
        leftIcon={<span>🍒</span>}
      >
        Sign in with Pi
      </Button>

      {displayError && (
        <p className="text-red-400 text-xs text-center max-w-xs">
          {displayError}{' '}
          <button
            onClick={handleRetry}
            className="underline hover:no-underline focus:outline-none"
          >
            Retry
          </button>
        </p>
      )}
    </div>
  );
}
