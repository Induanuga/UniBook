// src/controllers/casController.ts

import type { Request, Response } from 'express';
import { buildCasLoginUrl, validateCasTicket } from '../services/casService';
import { getUserByEmail, createUser } from '../models/userModel';
import { issueTokens, verifyRefreshToken, verifyAccessToken } from '../services/jwtIssuer';
import { revokeToken } from '../services/tokenBlacklist';
import { writeAuditLog } from '../services/auditLogger';
import { config } from '../config';
import type { User } from '../types';

// ─── GET /auth/cas/login ──────────────────────────────────────────────────────
export function casLogin(_req: Request, res: Response): void {
  const casUrl = buildCasLoginUrl();
  console.log(JSON.stringify({ level: 'INFO', message: 'CAS: redirecting to login', url: casUrl }));
  res.redirect(casUrl);
}

// ─── GET /auth/cas/logout ─────────────────────────────────────────────────────
// Kills the CAS server-side session so the next SSO click shows the login form.
// Called by the frontend after it clears localStorage.
// Tokens are passed as query params so we can revoke them and log who logged out.
export async function casLogout(req: Request, res: Response): Promise<void> {
  const { at, rt } = req.query as { at?: string; rt?: string };

  // Default actor info — will be overwritten if we can decode the access token
  let actorId    = 'unknown';
  let actorEmail = 'unknown';
  let actorRole: string | undefined;

  // Revoke access token and extract actor identity from it
  if (at) {
    try {
      const payload = verifyAccessToken(at);
      const exp     = payload.exp || Math.floor(Date.now() / 1000) + 8 * 3600;
      await revokeToken(payload.jti, exp);

      // Use the decoded payload to populate the audit log properly
      actorId    = payload.sub;
      actorEmail = payload.email;
      actorRole  = payload.role;
    } catch {
      // Token already expired — identity unknown but logout still proceeds
    }
  }

  // Revoke refresh token
  if (rt) {
    try {
      const payload = verifyRefreshToken(rt);
      const exp     = payload.exp || Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
      await revokeToken(payload.jti, exp);
    } catch { /* already expired — safe to ignore */ }
  }

  writeAuditLog({
    actor:         actorId,
    actorEmail:    actorEmail,
    endpoint:      '/auth/cas/logout',
    method:        'GET',
    action:        'CAS_LOGOUT',
    rolePresented: actorRole as any,
    ipAddress:     req.ip || 'unknown',
    userAgent:     req.headers['user-agent'] || 'unknown',
    success:       true,
    metadata:      { casLogout: true },
  });

  console.log(JSON.stringify({
    level:   'INFO',
    message: 'CAS: logout — revoking session and redirecting to CAS logout',
    actor:   actorEmail,
  }));

  // Redirect to CAS logout — kills the CAS server session.
  // The `service` param tells CAS where to send the user after logout.
  const casLogoutUrl =
    `${config.cas.serverUrl}/logout?service=${encodeURIComponent(config.cors.frontendUrl)}`;

  res.redirect(casLogoutUrl);
}

// ─── GET /auth/cas/callback ───────────────────────────────────────────────────
export async function casCallback(req: Request, res: Response): Promise<void> {
  const ticket = req.query.ticket as string | undefined;

  console.log(JSON.stringify({
    level:   'INFO',
    message: 'CAS: callback received',
    ticket:  ticket ? ticket.slice(0, 20) + '…' : 'MISSING',
  }));

  if (!ticket) {
    return redirectError(res, 'CAS login was cancelled or no ticket received.');
  }

  const result = await validateCasTicket(ticket);

  if (!result.success) {
    console.error(JSON.stringify({
      level: 'ERROR', message: 'CAS: ticket validation failed',
      errorCode: result.errorCode, errorMessage: result.errorMessage,
    }));
    writeAuditLog({
      actor: 'anonymous', actorEmail: 'anonymous',
      endpoint: '/auth/cas/callback', method: 'GET', action: 'CAS_TICKET_INVALID',
      ipAddress: req.ip || 'unknown', userAgent: req.headers['user-agent'] || 'unknown',
      success: false,
      metadata: { errorCode: result.errorCode, errorMessage: result.errorMessage },
    });
    return redirectError(res, result.errorMessage);
  }

  const { username, attributes } = result;

  // Derive email — prefer a full email attribute, fall back to netID@domain
  const rawEmail =
    attributes['email']                  ||
    attributes['mail']                   ||
    attributes['eduPersonPrincipalName'] ||
    attributes['userPrincipalName']      ||
    null;

  let email: string;
  if (rawEmail && rawEmail.includes('@')) {
    email = rawEmail.toLowerCase().trim();
  } else if (username.includes('@')) {
    email = username.toLowerCase().trim();
  } else {
    email = `${username}@iiit.ac.in`.toLowerCase().trim();
  }

  const casName =
    attributes['displayName'] ||
    attributes['cn']          ||
    attributes['name']        ||
    attributes['givenName']   ||
    username;

  let userRecord = await getUserByEmail(email);
  let isNewUser  = false;

  if (!userRecord) {
    isNewUser = true;
    const { v4: uuidv4 } = await import('uuid');
    userRecord = await createUser({
      email,
      name:         casName,
      role:         config.cas.defaultRole,
      department:   attributes['department'] || attributes['ou'] || '',
      passwordHash: `CAS_SSO_NO_PASSWORD_${uuidv4()}`,
    });
    console.log(JSON.stringify({
      level: 'INFO', message: 'CAS: new user auto-provisioned',
      email, role: config.cas.defaultRole,
    }));
  }

  const user: User = {
    id:         userRecord.id,
    email:      userRecord.email,
    name:       userRecord.name,
    role:       userRecord.role,
    department: userRecord.department || '',
    studentId:  userRecord.student_id,
    createdAt:  userRecord.created_at,
  };

  const { accessToken, refreshToken, expiresIn } = issueTokens(user);

  writeAuditLog({
    actor:         user.id,
    actorEmail:    user.email,
    endpoint:      '/auth/cas/callback',
    method:        'GET',
    action:        isNewUser ? 'CAS_LOGIN_NEW_USER' : 'CAS_LOGIN_SUCCESS',
    rolePresented: user.role,
    ipAddress:     req.ip || 'unknown',
    userAgent:     req.headers['user-agent'] || 'unknown',
    success:       true,
    metadata:      { casUsername: username, isNewUser },
  });

  const params = new URLSearchParams({
    accessToken,
    refreshToken,
    expiresIn: String(expiresIn),
    user:      JSON.stringify(user),
  });

  console.log(JSON.stringify({
    level: 'INFO', message: 'CAS: login complete, redirecting to frontend',
    user: user.email, isNewUser,
  }));

  res.redirect(`${config.cors.frontendUrl}/cas-callback#${params.toString()}`);
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function redirectError(res: Response, message: string): void {
  const params = new URLSearchParams({ error: message });
  res.redirect(`${config.cors.frontendUrl}/cas-callback#${params.toString()}`);
}
