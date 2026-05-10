// src/services/IdempotencyGuard.ts
// Tactic 1: Idempotency Guard — prevents duplicate booking submissions.
// Every POST /bookings must include a client-generated UUID idempotency_key.
// Duplicates within a 24-hour window return the cached result without re-executing.

import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CachedResponse {
  statusCode: number;
  body:       Record<string, unknown>;
}

export class IdempotencyGuard {
  constructor(private readonly db: Pool) {}

  /**
   * Check if a key has already been processed.
   * Returns the cached response if found, null if the key is fresh.
   */
  async check(key: string, correlationId?: string): Promise<CachedResponse | null> {
    const result = await this.db.query(
      `SELECT status_code, response
       FROM idempotency_keys
       WHERE key = $1 AND expires_at > NOW()`,
      [key],
    );

    if (result.rows.length) {
      logger.info({
        correlationId,
        component: 'IdempotencyGuard',
        action:    'DUPLICATE_DETECTED',
        key,
      });
      return {
        statusCode: result.rows[0].status_code as number,
        body:       result.rows[0].response as Record<string, unknown>,
      };
    }
    return null;
  }

  /**
   * Record a completed request so future duplicates return the cached response.
   * Must be called AFTER the booking transaction commits.
   */
  async record(
    key:        string,
    bookingId:  string,
    statusCode: number,
    body:       Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const expiresAt = new Date(
      Date.now() + config.idempotency.windowHours * 60 * 60 * 1000,
    );

    await this.db.query(
      `INSERT INTO idempotency_keys (key, booking_id, status_code, response, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO NOTHING`,
      [key, bookingId, statusCode, JSON.stringify(body), expiresAt.toISOString()],
    );

    logger.info({
      correlationId,
      component: 'IdempotencyGuard',
      action:    'KEY_RECORDED',
      key,
      bookingId,
    });
  }
}
