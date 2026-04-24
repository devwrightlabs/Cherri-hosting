import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, PiAuthResult, PiPaymentDTO } from '../types';
import { authApi, paymentsApi } from '../lib/api';

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
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('pi_access_token'),
  );
  const [isLoading, setIsLoading] = useState(false);

  // Re-hydrate user on mount using the token that was stored before this render.
  // We intentionally run this only once on mount; the token value at mount time
  // is captured via the lazy initialiser of useState above, so the closure is stable.
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

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
    localStorage.setItem('pi_access_token', accessToken);
    setToken(accessToken);

    try {
      const res = await authApi.signIn(accessToken, piUser.username);
      setUser((res.data as { user: User }).user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem('pi_access_token');
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const res = await authApi.me();
      setUser((res.data as { user: User }).user);
    } catch {
      // If refresh fails, keep the existing user state
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
