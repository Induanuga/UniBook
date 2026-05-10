// src/services/ConflictDetectionEngine.ts
// ASR-1: Conflict detection must be correct (zero double-bookings) AND fast (<= 150 ms).
//
// Strategy:
//   1. SELECT ... FOR UPDATE on overlapping rows inside a transaction (ADR-001).
//      This serialises concurrent inserts for the same resource slot at the DB level —
//      application-level locking is NOT used (NFR-1 trade-off section).
//   2. If conflicts exist, SlotSuggestionService returns next 3 free slots (FR-4).

import { Pool, PoolClient } from 'pg';
import type { Booking } from '../types';
import { logger } from '../utils/logger';

export interface ConflictResult {
  hasConflict: boolean;
  conflicting: Booking[];
}

export class ConflictDetectionEngine {
  constructor(private readonly db: Pool) {}

  /**
   * Check for overlapping approved/pending bookings on resourceId.
   * MUST be called inside an active DB transaction (client param required).
   * Uses SELECT FOR UPDATE to prevent concurrent inserts from racing through.
   *
   * NFR-1: this step must complete in <= 150 ms.
   */
  async check(
    resourceId:    string,
    startTime:     Date,
    endTime:       Date,
    client:        PoolClient,
    correlationId?: string,
  ): Promise<ConflictResult> {
    const t0 = Date.now();

    const result = await client.query(
      `SELECT id, resource_id, user_id, user_email, user_role, department,
              start_time, end_time, purpose, attendee_count,
              status, idempotency_key, version, created_at, updated_at
       FROM bookings
       WHERE resource_id = $1
         AND status IN ('PENDING','APPROVED')
         AND start_time < $3
         AND end_time   > $2
       FOR UPDATE`,
      [resourceId, startTime.toISOString(), endTime.toISOString()],
    );

    const elapsed = Date.now() - t0;
    const conflicting: Booking[] = result.rows.map((r) => ({
      id:             r.id as string,
      resourceId:     r.resource_id as string,
      userId:         r.user_id as string,
      userEmail:      r.user_email as string,
      userRole:       r.user_role as Booking['userRole'],
      department:     r.department as string,
      startTime:      new Date(r.start_time as string),
      endTime:        new Date(r.end_time as string),
      purpose:        r.purpose as string,
      attendeeCount:  r.attendee_count as number,
      status:         r.status as Booking['status'],
      idempotencyKey: r.idempotency_key as string,
      version:        r.version as number,
      createdAt:      new Date(r.created_at as string),
      updatedAt:      new Date(r.updated_at as string),
    }));

    logger.info({
      correlationId,
      component:   'ConflictDetectionEngine',
      action:      conflicting.length ? 'CONFLICT_FOUND' : 'CLEAR',
      resourceId,
      conflictCount: conflicting.length,
      elapsedMs:   elapsed,
    });

    if (elapsed > 150) {
      logger.warn({
        correlationId,
        component: 'ConflictDetectionEngine',
        action:    'LATENCY_BREACH',
        elapsedMs: elapsed,
        threshold: 150,
      });
    }

    return { hasConflict: conflicting.length > 0, conflicting };
  }
}
