// src/controllers/authController.ts
// FIX: logout() now revokes tokens by their proper jti UUID.
//      refreshToken() checks the refresh token's jti against the blacklist.
//      Both fixes apply equally to CAS and email/password users.

import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getUserByEmail, getUserById, createUser } from '../models/userModel';
import { issueTokens, verifyRefreshToken } from '../services/jwtIssuer';
import { revokeToken, isRevoked } from '../services/tokenBlacklist';
import { writeAuditLog, getAuditLogFromDb } from '../services/auditLogger';
import type { LoginRequest, User } from '../types';

function toUser(record: any): User {
  return {
    id:         record.id,
    email:      record.email,
    name:       record.name,
    role:       record.role,
    department: record.department || '',
    studentId:  record.student_id,
    createdAt:  record.created_at,
  };
}

// ─── POST /auth/signup ────────────────────────────────────────────────────────
export async function signup(req: Request, res: Response): Promise<void> {
  const { email, password, name, role, department } = req.body;

  if (!email || !password || !name || !role) {
    res.status(400).json({ error: 'Missing required fields: email, password, name, role', code: 'MISSING_FIELDS' });
    return;
  }

  const validRoles = ['STUDENT', 'FACULTY', 'ADMIN', 'IT_STAFF'];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}`, code: 'INVALID_ROLE' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters', code: 'WEAK_PASSWORD' });
    return;
  }

  const existing = await getUserByEmail(email.toLowerCase().trim());
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists', code: 'USER_EXISTS' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = await createUser({ email, name, role, department, passwordHash });

  writeAuditLog({
    actor: newUser.id, actorEmail: newUser.email,
    endpoint: '/auth/signup', method: 'POST', action: 'SIGNUP_SUCCESS',
    rolePresented: newUser.role, ipAddress: req.ip || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown', success: true,
  });

  res.status(201).json({ message: 'Account created successfully. Please log in.', user: toUser(newUser) });
}

// ─── POST /auth/login ─────────────────────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginRequest;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required', code: 'MISSING_FIELDS' });
    return;
  }

  const userRecord = await getUserByEmail(email.toLowerCase().trim());

  // Block CAS-only accounts from email/password login
  if (userRecord?.password_hash?.startsWith('CAS_SSO_NO_PASSWORD_')) {
    res.status(401).json({
      error: 'This account uses University SSO. Please use the "Login with University SSO" button.',
      code: 'SSO_ACCOUNT',
    });
    return;
  }

  const dummyHash = '$2b$10$invalidhashusedtopreventimuserationattacks00000000000';
  const hash = userRecord?.password_hash || dummyHash;
  const passwordValid = await bcrypt.compare(password, hash);

  if (!userRecord || !passwordValid) {
    writeAuditLog({
      actor: 'anonymous', actorEmail: email,
      endpoint: '/auth/login', method: 'POST', action: 'LOGIN_FAILED',
      ipAddress: req.ip || 'unknown', userAgent: req.headers['user-agent'] || 'unknown',
      success: false, metadata: { reason: 'invalid_credentials' },
    });
    res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    return;
  }

  const user = toUser(userRecord);
  const { accessToken, refreshToken, expiresIn } = issueTokens(user);

  writeAuditLog({
    actor: user.id, actorEmail: user.email,
    endpoint: '/auth/login', method: 'POST', action: 'LOGIN_SUCCESS',
    rolePresented: user.role, ipAddress: req.ip || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown', success: true,
  });

  res.status(200).json({ accessToken, refreshToken, expiresIn, user });
}

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
export async function refreshToken(req: Request, res: Response): Promise<void> {
  const { refreshToken: token } = req.body as { refreshToken: string };

  if (!token) {
    res.status(400).json({ error: 'Refresh token is required', code: 'MISSING_REFRESH_TOKEN' });
    return;
  }

  try {
    const payload = verifyRefreshToken(token);

    // FIX: Check the refresh token's own jti against the blacklist.
    // This correctly catches logout for BOTH CAS and email/password users.
    if (await isRevoked(payload.jti)) {
      res.status(401).json({
        error: 'Session has been revoked. Please log in again.',
        code: 'TOKEN_REVOKED',
      });
      return;
    }

    const userRecord = await getUserById(payload.sub);
    if (!userRecord) {
      res.status(401).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      return;
    }

    const user = toUser(userRecord);
    const { accessToken, expiresIn } = issueTokens(user);

    writeAuditLog({
      actor: user.id, actorEmail: user.email,
      endpoint: '/auth/refresh', method: 'POST', action: 'TOKEN_REFRESH',
      rolePresented: user.role, ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown', success: true,
    });

    res.status(200).json({ accessToken, expiresIn });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' });
  }
}

// ─── POST /auth/logout ────────────────────────────────────────────────────────
// FIX: Revokes BOTH tokens using their jti UUID field.
// Works identically for CAS and email/password users.
export async function logout(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
    return;
  }

  // Revoke access token by its jti (now always a proper UUID)
  const accessExp = req.user.exp || Math.floor(Date.now() / 1000) + 8 * 3600;
  await revokeToken(req.user.jti, accessExp);

  // Revoke refresh token if provided
  const { refreshToken: rt } = req.body as { refreshToken?: string };
  if (rt) {
    try {
      const rtPayload = verifyRefreshToken(rt);
      const refreshExp = rtPayload.exp || Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
      await revokeToken(rtPayload.jti, refreshExp);
    } catch {
      // Refresh token already expired — access token is revoked anyway
    }
  }

  writeAuditLog({
    actor: req.user.sub, actorEmail: req.user.email,
    endpoint: '/auth/logout', method: 'POST', action: 'LOGOUT',
    rolePresented: req.user.role, ipAddress: req.ip || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown', success: true,
  });

  res.status(200).json({ message: 'Logged out successfully' });
}

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
export async function getMe(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
    return;
  }

  const userRecord = await getUserById(req.user.sub);
  if (!userRecord) {
    res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    return;
  }

  res.status(200).json({ user: toUser(userRecord) });
}

// ─── GET /auth/audit-log ──────────────────────────────────────────────────────
export async function getAuditLog(_req: Request, res: Response): Promise<void> {
  const entries = await getAuditLogFromDb(500);
  res.status(200).json({ entries, count: entries.length });
}

// ─── GET /auth/users ──────────────────────────────────────────────────────────
// Accepts optional ?role=FACULTY|ADMIN|STUDENT|IT_STAFF query param.
// Protected by user JWT (ADMIN/IT_STAFF) OR internal X-Service-Key header.
export async function listUsers(req: Request, res: Response): Promise<void> {
  const { pool } = await import('../db');
  const role = req.query.role as string | undefined;

  let query: string;
  let params: string[];

  if (role) {
    query = `SELECT id, email, name, role, department, student_id, created_at
             FROM users WHERE role = $1 ORDER BY created_at DESC`;
    params = [role.toUpperCase()];
  } else {
    query = `SELECT id, email, name, role, department, student_id, created_at
             FROM users ORDER BY created_at DESC`;
    params = [];
  }

  const result = await pool.query(query, params);
  res.status(200).json({ users: result.rows.map(toUser) });
}
