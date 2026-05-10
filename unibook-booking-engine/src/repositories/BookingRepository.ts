// src/repositories/BookingRepository.ts
// Repository pattern — encapsulates all PostgreSQL access for the bookings table.
// Implements optimistic locking via version column (ADR-001, Tactic 1).

import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { Booking, BookingStatus } from '../types';
import { logger } from '../utils/logger';

/** Raw DB row → Booking domain object */
function rowToBooking(row: Record<string, unknown>): Booking {
  return {
    id:             row.id as string,
    resourceId:     row.resource_id as string,
    userId:         row.user_id as string,
    userEmail:      row.user_email as string,
    userRole:       row.user_role as Booking['userRole'],
    department:     row.department as string,
    startTime:      new Date(row.start_time as string),
    endTime:        new Date(row.end_time as string),
    purpose:        row.purpose as string,
    attendeeCount:  row.attendee_count as number,
    status:         row.status as BookingStatus,
    idempotencyKey: row.idempotency_key as string,
    version:        row.version as number,
    createdAt:      new Date(row.created_at as string),
    updatedAt:      new Date(row.updated_at as string),
  };
}

export interface InsertBookingParams {
  resourceId:     string;
  userId:         string;
  userEmail:      string;
  userRole:       Booking['userRole'];
  department:     string;
  startTime:      Date;
  endTime:        Date;
  purpose:        string;
  attendeeCount:  number;
  idempotencyKey: string;
}

export class BookingRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Insert a new booking atomically.
   * Returns the created booking or null if a concurrent version conflict occurred.
   * Caller must provide a PoolClient when running inside a transaction.
   */
  async insert(
    params: InsertBookingParams,
    client?: PoolClient,
  ): Promise<Booking> {
    const executor = client ?? this.db;
    const id = uuidv4();

    const result = await executor.query(
      `INSERT INTO bookings
         (id, resource_id, user_id, user_email, user_role, department,
          start_time, end_time, purpose, attendee_count, status, idempotency_key, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING',$11,1)
       RETURNING *`,
      [
        id,
        params.resourceId,
        params.userId,
        params.userEmail,
        params.userRole,
        params.department,
        params.startTime.toISOString(),
        params.endTime.toISOString(),
        params.purpose,
        params.attendeeCount,
        params.idempotencyKey,
      ],
    );

    return rowToBooking(result.rows[0]);
  }

  /** Find by ID — returns null if not found. */
  async findById(id: string): Promise<Booking | null> {
    const result = await this.db.query(
      'SELECT * FROM bookings WHERE id = $1',
      [id],
    );
    return result.rows.length ? rowToBooking(result.rows[0]) : null;
  }

  /** All bookings for a given user (GET /bookings/mine). */
  async findByUserId(userId: string): Promise<Booking[]> {
    const result = await this.db.query(
      `SELECT * FROM bookings
       WHERE user_id = $1
       ORDER BY start_time DESC
       LIMIT 100`,
      [userId],
    );
    return result.rows.map(rowToBooking);
  }

  /**
   * Update booking status with optimistic locking.
   * Returns updated booking, or null if version mismatch (stale read).
   */
  async updateStatus(
    id: string,
    newStatus: BookingStatus,
    expectedVersion: number,
    client?: PoolClient,
  ): Promise<Booking | null> {
    const executor = client ?? this.db;
    const result = await executor.query(
      `UPDATE bookings
       SET status = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND version = $3
       RETURNING *`,
      [newStatus, id, expectedVersion],
    );
    if (!result.rows.length) {
      logger.warn({
        component: 'BookingRepository',
        action:    'OPTIMISTIC_LOCK_MISS',
        bookingId: id,
        expectedVersion,
      });
      return null;
    }
    return rowToBooking(result.rows[0]);
  }

  /**
   * Cancel a booking — only the owning user or an Admin may cancel.
   * Uses optimistic locking so concurrent cancellations are safe.
   */
  async cancel(
    id:              string,
    requestingUserId: string,
    requestingRole:  string,
  ): Promise<Booking | null> {
    // First fetch current state
    const booking = await this.findById(id);
    if (!booking) return null;

    // Only owner or Admin can cancel
    if (booking.userId !== requestingUserId && requestingRole !== 'ADMIN') {
      return null;
    }

    // Can only cancel PENDING or APPROVED bookings
    if (!['PENDING', 'APPROVED'].includes(booking.status)) {
      return null;
    }

    return this.updateStatus(id, 'CANCELLED', booking.version);
  }

  /**
   * Check for overlapping active bookings on the same resource.
   * Uses SELECT FOR UPDATE to prevent concurrent inserts racing through (ADR-001).
   */
  async findOverlapping(
    resourceId: string,
    startTime:  Date,
    endTime:    Date,
    excludeId?: string,
    client?:    PoolClient,
  ): Promise<Booking[]> {
    const executor = client ?? this.db;
    const params: unknown[] = [
      resourceId,
      startTime.toISOString(),
      endTime.toISOString(),
    ];
    let excludeClause = '';
    if (excludeId) {
      params.push(excludeId);
      excludeClause = `AND id != $${params.length}`;
    }

    const result = await executor.query(
      `SELECT * FROM bookings
       WHERE resource_id = $1
         AND status IN ('PENDING','APPROVED')
         AND start_time < $3
         AND end_time   > $2
         ${excludeClause}
       FOR UPDATE`,
      params,
    );
    return result.rows.map(rowToBooking);
  }

  /** Delete stale idempotency keys — run periodically for cleanup. */
  async cleanExpiredIdempotencyKeys(): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM idempotency_keys WHERE expires_at < NOW()`,
    );
    return result.rowCount ?? 0;
  }

  /**
   * Update booking status — called by Approval Workflow (Subsystem 4).
   * Uses optimistic locking via expectedVersion to prevent race conditions.
   * Returns null if booking not found or version conflict.
   */
  async updateStatusFromApproval(
    bookingId:       string,
    newStatus:       'APPROVED' | 'REJECTED',
    expectedVersion: number,
  ): Promise<Booking | null> {
    const result = await this.db.query(
      `UPDATE bookings
       SET status     = $1,
           version    = version + 1,
           updated_at = NOW()
       WHERE id = $2
         AND version = $3
       RETURNING *`,
      [newStatus, bookingId, expectedVersion],
    );
    if (result.rows.length === 0) return null;
    return rowToBooking(result.rows[0]);
  }
}
