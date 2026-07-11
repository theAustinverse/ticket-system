import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'ticket-system-token';

interface AuthContextValue {
  token: string | null;
  setToken: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  const setToken = (newToken: string) => {
    localStorage.setItem(STORAGE_KEY, newToken);
    setTokenState(newToken);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setTokenState(null);
  };

  return (
    <AuthContext.Provider value={{ token, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
