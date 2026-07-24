import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'admin-token';

interface AdminAuthContextValue {
  token: string | null;
  setToken: (token: string) => void;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);

/**
 * Deliberately separate from AuthContext/useAuth (which stores the
 * customer session under a different key). Admin login mints a JWT with a
 * fake `sub: 'admin'` that doesn't correspond to any User row, so sharing
 * storage with the customer session broke ticket purchases for anyone who
 * had also logged into the back office in the same browser.
 *
 * Must be a shared Context (not a bare hook each caller instantiates its
 * own state for) — otherwise the navbar's login/logout never propagates to
 * whichever admin page is currently mounted, and vice versa.
 */
export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  function setToken(newToken: string) {
    localStorage.setItem(STORAGE_KEY, newToken);
    setTokenState(newToken);
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    setTokenState(null);
  }

  return (
    <AdminAuthContext.Provider value={{ token, setToken, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
