// src/middleware/jwtValidator.ts
// FIX: Revocation check now uses payload.jti (proper UUID) instead of
// the broken `sub-iat` composite that was undefined for CAS users.

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/jwtIssuer';
import { isRevoked } from '../services/tokenBlacklist';
import { writeAuditLog } from '../services/auditLogger';

export async function validateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    writeAuditLog({
      actor:     'anonymous',
      actorEmail: 'anonymous',
      endpoint:  req.path,
      method:    req.method,
      action:    'ACCESS_DENIED_NO_TOKEN',
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      success:   false,
    });
    res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyAccessToken(token);

    // FIX: use payload.jti — always a UUID, works for both CAS and email/password users
    if (await isRevoked(payload.jti)) {
      writeAuditLog({
        actor:         payload.sub,
        actorEmail:    payload.email,
        endpoint:      req.path,
        method:        req.method,
        action:        'ACCESS_DENIED_REVOKED_TOKEN',
        rolePresented: payload.role,
        ipAddress:     req.ip || 'unknown',
        userAgent:     req.headers['user-agent'] || 'unknown',
        success:       false,
      });
      res.status(401).json({ error: 'Token has been revoked. Please log in again.', code: 'TOKEN_REVOKED' });
      return;
    }

    req.user          = payload;
    req.correlationId = (req.headers['x-correlation-id'] as string) || `req-${Date.now()}`;
    next();
  } catch {
    writeAuditLog({
      actor:     'anonymous',
      actorEmail: 'anonymous',
      endpoint:  req.path,
      method:    req.method,
      action:    'ACCESS_DENIED_INVALID_TOKEN',
      ipAddress: req.ip || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      success:   false,
    });
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
}
