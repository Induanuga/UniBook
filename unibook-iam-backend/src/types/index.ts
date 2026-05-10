// src/types/index.ts
// FIX: Added `jti` field to both JWTPayload and RefreshTokenPayload.
// This is the stable, unique identifier used for token revocation.

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

export interface UserRecord extends User {
  passwordHash: string;
}

export interface JWTPayload {
  jti:        string;   // ← unique token ID for blacklisting
  sub:        string;   // userId
  email:      string;
  name:       string;
  role:       UserRole;
  department: string;
  iat?:       number;
  exp?:       number;
}

export interface RefreshTokenPayload {
  jti:         string;  // ← unique token ID for blacklisting
  sub:         string;
  tokenFamily: string;
  iat?:        number;
  exp?:        number;
}

export interface AuditLogEntry {
  id:             string;
  actor:          string;
  actorEmail:     string;
  endpoint:       string;
  method:         string;
  action:         string;
  roleRequired?:  UserRole;
  rolePresented?: UserRole;
  ipAddress:      string;
  userAgent:      string;
  timestamp:      string;
  success:        boolean;
  metadata?:      Record<string, unknown>;
}

export interface TokenBlacklistEntry {
  jti:       string;
  expiresAt: number;
}

export interface LoginRequest {
  email:    string;
  password: string;
}

export interface LoginResponse {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
  user:         User;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn:   number;
}

declare global {
  namespace Express {
    interface Request {
      user?:          JWTPayload;
      correlationId?: string;
    }
  }
}
