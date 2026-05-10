// src/middleware/validateToken.ts
// JWT validation middleware (NFR-2 — 100% of non-public API routes protected).
// Shares the same JWT_SECRET as IAM (RS256 symmetric variant using HS256 here)
// so no inter-service token exchange is needed. Mirrors Booking Engine exactly.

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JWTPayload } from '../types';
import { logger } from '../utils/logger';

export async function validateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn({
      correlationId: req.correlationId,
      component:     'validateToken',
      action:        'ACCESS_DENIED_NO_TOKEN',
      path:          req.path,
    });
    res.status(401).json({ error: 'Authentication required', code: 'NO_TOKEN' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token, config.jwt.secret, {
      issuer:   'unibook-iam',
      audience: 'unibook-api',
    }) as JWTPayload;

    req.user = payload;
    next();
  } catch {
    logger.warn({
      correlationId: req.correlationId,
      component:     'validateToken',
      action:        'ACCESS_DENIED_INVALID_TOKEN',
      path:          req.path,
    });
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
}
