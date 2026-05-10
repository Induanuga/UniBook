// src/types/auth.ts
export type UserRole = 'STUDENT' | 'FACULTY' | 'ADMIN' | 'IT_STAFF';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  department: string;
  studentId?: string;
  createdAt: string;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}
