// src/services/jwtIssuer.ts
// FIX: Both access token and refresh token now carry a proper `jti` (JWT ID)
// field. The blacklist always uses this jti — consistent and unique per token,
// regardless of how the user logged in (email/password OR CAS SSO).

import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import type { JWTPayload, RefreshTokenPayload, User } from '../types';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  // Expose jti values so callers can revoke without re-decoding
  accessJti: string;
  refreshJti: string;
}

/**
 * Issue a new access + refresh token pair.
 * Both tokens carry a unique `jti` used for blacklisting on logout.
 */
export function issueTokens(user: User): IssuedTokens {
  const accessJti  = uuidv4();
  const refreshJti = uuidv4();

  const accessPayload: JWTPayload = {
    jti:        accessJti,
    sub:        user.id,
    email:      user.email,
    name:       user.name,
    role:       user.role,
    department: user.department,
  };

  const accessToken = jwt.sign(accessPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as string,
    issuer:    'unibook-iam',
    audience:  'unibook-api',
  });

  const refreshPayload: RefreshTokenPayload = {
    jti:         refreshJti,
    sub:         user.id,
    tokenFamily: uuidv4(),
  };

  const refreshToken = jwt.sign(refreshPayload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as string,
    issuer:    'unibook-iam',
    audience:  'unibook-refresh',
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 8 * 60 * 60, // 8 hours in seconds
    accessJti,
    refreshJti,
  };
}

export function verifyAccessToken(token: string): JWTPayload {
  const decoded = jwt.verify(token, config.jwt.secret, {
    issuer:   'unibook-iam',
    audience: 'unibook-api',
  });
  return decoded as JWTPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, config.jwt.refreshSecret, {
    issuer:   'unibook-iam',
    audience: 'unibook-refresh',
  });
  return decoded as RefreshTokenPayload;
}
