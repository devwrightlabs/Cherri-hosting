import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { User, PiAuthResult, PiPaymentDTO } from '../types';
import { authApi } from '../lib/api';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: () => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function handleIncompletePayment(payment: PiPaymentDTO) {
  // In production: call backend to check payment status and complete if necessary
  console.warn('Incomplete Pi payment found:', payment.identifier);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem('pi_access_token'),
  );
  const [isLoading, setIsLoading] = useState(false);

  // Re-hydrate user on mount if we have a stored token
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        signIn,
        signOut,
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
