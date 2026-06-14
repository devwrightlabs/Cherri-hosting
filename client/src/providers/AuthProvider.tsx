import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { User, PiAuthResult, PiPaymentDTO } from '../types';
import { authApi, paymentsApi } from '../lib/api';
import { usePiSDK } from './PiSDKProvider';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function handleIncompletePayment(payment: PiPaymentDTO) {
  paymentsApi.verify(payment.identifier).catch((err: unknown) => {
    console.warn(
      'Could not recover incomplete Pi payment:',
      payment.identifier,
      err instanceof Error ? err.message : err,
    );
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { state: sdkState } = usePiSDK();

  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('pi_access_token'),
  );
  const [isLoading, setIsLoading] = useState(false);

  // Prevent the auto-sign-in from firing more than once per SDK ready event.
  const autoSignInAttempted = useRef(false);

  // Re-hydrate session from stored token on mount.
  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    authApi
      .me()
      .then((res) => setUser((res.data as { user: User }).user))
      .catch(() => {
        localStorage.removeItem('pi_access_token');
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async () => {
    if (!window.Pi) throw new Error('Pi SDK not ready');
    setIsLoading(true);

    let authResult: PiAuthResult | null = null;

    // Retry up to 3 times with exponential back-off in case the Pi Browser
    // dialog is momentarily unavailable.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Request "username" for identity and "payments" for Pi.createPayment().
        // Pi.init() is fully awaited before this point (see PiSDKProvider),
        // so the call order is guaranteed.
        authResult = await window.Pi.authenticate(
          ['username', 'payments'],
          handleIncompletePayment,
        );
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 1_000 * Math.pow(2, attempt)));
      }
    }

    if (!authResult) throw new Error('Pi authentication failed');

    const { accessToken, user: piUser } = authResult;

    // Persist token so subsequent page loads skip re-auth.
    localStorage.setItem('pi_access_token', accessToken);
    setToken(accessToken);

    try {
      // Backend validates the token by calling GET /v2/me on api.minepi.com
      // with Authorization: Bearer <accessToken> before creating/updating the
      // user record. No Pi server-side API key is required for this flow.
      const res = await authApi.signIn(accessToken, piUser.username);
      setUser((res.data as { user: User }).user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-trigger authentication the moment the SDK is ready and no session
  // exists. Inside Pi Browser this immediately raises the native permission
  // dialog (username scope). Outside Pi Browser the call fails silently and
  // the user can sign in manually via the button.
  useEffect(() => {
    if (sdkState !== 'ready' || token || autoSignInAttempted.current) return;
    autoSignInAttempted.current = true;
    signIn().catch(() => {
      // Failure is expected outside Pi Browser — reset so the button works.
      autoSignInAttempted.current = false;
    });
  }, [sdkState, token, signIn]);

  const signOut = useCallback(() => {
    localStorage.removeItem('pi_access_token');
    setToken(null);
    setUser(null);
    autoSignInAttempted.current = false;
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const res = await authApi.me();
      setUser((res.data as { user: User }).user);
    } catch {
      // Keep existing user state on transient refresh failure.
    }
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        signIn,
        signOut,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
