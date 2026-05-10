// src/services/authService.ts
// FIX: logout() sends both accessToken and refreshToken to the backend
// so the server can revoke both. This is critical for CAS users whose
// refresh token jti must be blacklisted to prevent re-login after logout.

import type { LoginCredentials, LoginResponse, RefreshResponse, User } from '../types/auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res  = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export const authService = {
  login: (credentials: LoginCredentials): Promise<LoginResponse> =>
    apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),

  signup: (data: {
    email: string;
    password: string;
    name: string;
    role: string;
    department?: string;
  }): Promise<{ message: string; user: User }> =>
    apiFetch('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),

  refreshToken: (refreshToken: string): Promise<RefreshResponse> =>
    apiFetch<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  // FIX: Always sends the refreshToken in the body so the backend can
  // revoke it. Without this, a CAS user's refresh token stays valid
  // after logout and can be used to mint new access tokens.
  logout: (accessToken: string, refreshToken?: string | null): Promise<void> =>
    apiFetch<void>(
      '/auth/logout',
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken: refreshToken ?? undefined }),
      },
      accessToken
    ),

  getMe: (accessToken: string): Promise<{ user: User }> =>
    apiFetch<{ user: User }>('/auth/me', {}, accessToken),
};
