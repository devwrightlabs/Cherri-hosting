import { useState, useCallback } from 'react';
import { useAuth } from '../providers/AuthProvider';

interface UsePiAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
}

export function usePiAuth(): UsePiAuthReturn {
  const { isAuthenticated, isLoading, signIn: contextSignIn, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await contextSignIn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setError(msg);
    }
  }, [contextSignIn]);

  return { isAuthenticated, isLoading, error, signIn, signOut };
}
