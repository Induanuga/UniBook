// src/context/AuthContext.tsx

import {
  createContext, useContext, useEffect,
  useRef, useState, useCallback,
} from 'react';
import type { ReactNode } from 'react';
import type { AuthState, LoginCredentials, User } from '../types/auth';
import { authService } from '../services/authService';
import { tokenStorage } from '../utils/tokenStorage';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface AuthContextValue extends AuthState {
  login:          (credentials: LoginCredentials) => Promise<void>;
  logout:         () => Promise<void>;
  refreshSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const REFRESH_MARGIN_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null, accessToken: null, refreshToken: null,
    isAuthenticated: false, isLoading: true,
  });

  const refreshTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentRefreshRef = useRef<(() => Promise<void>) | null>(null);

  const scheduleRefresh = useCallback((expiresIn: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const delay = Math.max(expiresIn * 1000 - REFRESH_MARGIN_MS, 5_000);
    refreshTimerRef.current = setTimeout(() => {
      silentRefreshRef.current?.();
    }, delay);
  }, []);

  const silentRefresh = useCallback(async () => {
    const rt = tokenStorage.getRefreshToken();
    if (!rt) {
      tokenStorage.clearSession();
      setState({ user: null, accessToken: null, refreshToken: null,
                 isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const { accessToken, expiresIn } = await authService.refreshToken(rt);
      tokenStorage.updateAccessToken(accessToken, expiresIn);
      setState((prev) => ({ ...prev, accessToken }));
      scheduleRefresh(expiresIn);
    } catch {
      tokenStorage.clearSession();
      setState({ user: null, accessToken: null, refreshToken: null,
                 isAuthenticated: false, isLoading: false });
    }
  }, [scheduleRefresh]);

  silentRefreshRef.current = silentRefresh;

  const loadFromStorage = useCallback(async () => {
    if (!tokenStorage.hasSession()) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    const storedRefreshToken = tokenStorage.getRefreshToken()!;
    const cachedUser         = tokenStorage.getUser<User>();

    if (!tokenStorage.isAccessTokenExpired()) {
      const accessToken = tokenStorage.getAccessToken()!;
      const remaining   = Math.floor((tokenStorage.getExpiresAt() - Date.now()) / 1000);
      setState({ user: cachedUser, accessToken, refreshToken: storedRefreshToken,
                 isAuthenticated: true, isLoading: false });
      scheduleRefresh(remaining);
      return;
    }

    try {
      const { accessToken, expiresIn } = await authService.refreshToken(storedRefreshToken);
      tokenStorage.updateAccessToken(accessToken, expiresIn);
      const { user } = await authService.getMe(accessToken);
      setState({ user, accessToken, refreshToken: storedRefreshToken,
                 isAuthenticated: true, isLoading: false });
      scheduleRefresh(expiresIn);
    } catch {
      tokenStorage.clearSession();
      setState({ user: null, accessToken: null, refreshToken: null,
                 isAuthenticated: false, isLoading: false });
    }
  }, [scheduleRefresh]);

  useEffect(() => {
    loadFromStorage();
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, [loadFromStorage]);

  const login = useCallback(async (credentials: LoginCredentials) => {
    const { accessToken, refreshToken, expiresIn, user } = await authService.login(credentials);
    tokenStorage.saveSession(accessToken, refreshToken, expiresIn, user);
    setState({ user, accessToken, refreshToken, isAuthenticated: true, isLoading: false });
    scheduleRefresh(expiresIn);
  }, [scheduleRefresh]);

  const logout = useCallback(async () => {
    const accessToken  = state.accessToken;
    const refreshToken = state.refreshToken;
    const isCasUser    = state.user ? tokenStorage.isCasUser() : false;

    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    // Clear local session immediately
    tokenStorage.clearSession();
    setState({ user: null, accessToken: null, refreshToken: null,
               isAuthenticated: false, isLoading: false });

    if (isCasUser && accessToken) {
      // THE FIX: For CAS users, redirect the browser to the backend CAS logout
      // endpoint which then redirects to CAS server to kill the CAS session.
      // Without this, the CAS server still has an active session and auto-logs
      // the user back in the moment they click "Login with University SSO" again.
      //
      // We pass the tokens as query params so the backend can revoke them
      // before redirecting to CAS logout.
      const params = new URLSearchParams();
      params.set('at', accessToken);
      if (refreshToken) params.set('rt', refreshToken);

      // Small delay so clearSession() fully executes before navigation
      setTimeout(() => {
        window.location.href = `${API_BASE}/auth/cas/logout?${params.toString()}`;
      }, 50);

    } else if (accessToken) {
      // Email/password user — just revoke tokens on backend, no CAS redirect needed
      authService.logout(accessToken, refreshToken).catch(() => {
        // best-effort — localStorage already cleared
      });
    }
  }, [state.accessToken, state.refreshToken, state.user]);

  const refreshSession = useCallback(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
