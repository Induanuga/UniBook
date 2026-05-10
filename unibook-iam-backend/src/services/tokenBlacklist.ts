// src/services/tokenBlacklist.ts
// FIX: Uses token.jti directly (now always a proper UUID, never undefined).
// Persists to DB so revocations survive server restarts.
// In-memory map is a fast cache in front of the DB.

import type { TokenBlacklistEntry } from '../types';

const blacklist: Map<string, TokenBlacklistEntry> = new Map();
let dbLoaded = false;

/**
 * Revoke a token by its jti until it naturally expires.
 * expiresAt is a Unix timestamp in SECONDS (same as JWT exp).
 */
export async function revokeToken(jti: string, expiresAt: number): Promise<void> {
  blacklist.set(jti, { jti, expiresAt });
  cleanExpired();

  // Persist to DB so revocation survives server restart
  persistRevocation(jti, expiresAt).catch((err) => {
    console.error(JSON.stringify({
      level: 'ERROR',
      message: 'tokenBlacklist: DB persist failed',
      jti,
      error: (err as Error).message,
    }));
  });
}

/**
 * Returns true if the token jti has been explicitly revoked.
 */
export async function isRevoked(jti: string): Promise<boolean> {
  if (!dbLoaded) await loadFromDb();

  const entry = blacklist.get(jti);
  if (!entry) return false;

  // Expired naturally — clean up and treat as not revoked
  if (Date.now() > entry.expiresAt * 1000) {
    blacklist.delete(jti);
    return false;
  }

  return true;
}

async function persistRevocation(jti: string, expiresAt: number): Promise<void> {
  const { pool } = await import('../db');
  await pool.query(
    `INSERT INTO revoked_tokens (jti, expires_at)
     VALUES ($1, to_timestamp($2))
     ON CONFLICT (jti) DO NOTHING`,
    [jti, expiresAt]
  );
}

async function loadFromDb(): Promise<void> {
  try {
    const { pool } = await import('../db');
    const result = await pool.query(
      `SELECT jti, EXTRACT(EPOCH FROM expires_at)::bigint AS expires_at
       FROM revoked_tokens
       WHERE expires_at > NOW()`
    );
    for (const row of result.rows) {
      blacklist.set(row.jti, { jti: row.jti, expiresAt: Number(row.expires_at) });
    }
  } catch {
    // DB not available — in-memory cache still works for this session
  } finally {
    dbLoaded = true;
  }
}

function cleanExpired(): void {
  const now = Date.now();
  for (const [jti, entry] of blacklist.entries()) {
    if (now > entry.expiresAt * 1000) blacklist.delete(jti);
  }
}
