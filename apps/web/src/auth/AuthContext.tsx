import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AccountUser } from '@chatapp/shared';
import { getMe, logout as logoutRequest } from '../api/auth';

// Holds the current session for the app. On load we rehydrate from
// GET /auth/me (the session lives in an httpOnly cookie the JS can't read),
// so `status` starts as 'loading' until that resolves. See REQUIREMENTS.md §7.
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AccountUser | null;
  /** Seed the session after a successful login. */
  setUser: (user: AccountUser) => void;
  /** Clear the session server-side and locally. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AccountUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let active = true;
    getMe()
      .then((res) => {
        if (!active) return;
        setUserState(res.user);
        setStatus('authenticated');
      })
      .catch(() => {
        // 401 (no session) or any failure to confirm one: treat as logged out.
        if (!active) return;
        setUserState(null);
        setStatus('unauthenticated');
      });
    return () => {
      active = false;
    };
  }, []);

  function setUser(next: AccountUser) {
    setUserState(next);
    setStatus('authenticated');
  }

  async function logout() {
    try {
      await logoutRequest();
    } finally {
      // Clear locally regardless: the session cookie is cleared by the server,
      // and we never want the UI to stay in an authenticated state after a
      // logout attempt.
      setUserState(null);
      setStatus('unauthenticated');
    }
  }

  return (
    <AuthContext.Provider value={{ status, user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
