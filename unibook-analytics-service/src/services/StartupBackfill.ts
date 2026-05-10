// src/services/StartupBackfill.ts
// Runs automatically on server startup to sync analytics_events from the
// approval workflow and booking engine databases.
//
// Idempotent — uses ON CONFLICT DO NOTHING so re-running is always safe.
// Non-fatal — if source DBs are unavailable, the service still starts.

import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function runStartupBackfill(analyticsPool: Pool): Promise<void> {
  const approvalPool = new Pool({ connectionString: config.db.approvalUrl, max: 3, connectionTimeoutMillis: 3000 });
  const bookingPool  = new Pool({ connectionString: config.db.bookingUrl,  max: 3, connectionTimeoutMillis: 3000 });

  try {
    logger.info({ component: 'StartupBackfill', action: 'START' });

    // ── 1. BookingSubmitted — from ALL approval_requests ──────────────────────
    const { rows: submitted } = await approvalPool.query(`
      SELECT booking_id, resource_id, requester_id AS user_id,
             COALESCE(department, '') AS department,
             start_time, end_time, created_at AS recorded_at
      FROM approval_requests ORDER BY created_at ASC
    `);

    let n1 = 0;
    for (const row of submitted) {
      const r = await analyticsPool.query(
        `INSERT INTO analytics_events
           (event_type, booking_id, resource_id, user_id, department, start_time, end_time)
         VALUES ('BookingSubmitted',$1,$2,$3,$4,$5,$6)
         ON CONFLICT (booking_id, event_type) DO NOTHING`,
        [row.booking_id, row.resource_id, row.user_id, row.department, row.start_time, row.end_time],
      );
      if ((r.rowCount ?? 0) > 0) n1++;
    }

    // ── 2. BookingApproved / BookingRejected / BookingAlternativeSuggested ──────
    const { rows: decided } = await approvalPool.query(`
      SELECT booking_id, resource_id, requester_id AS user_id,
             COALESCE(department, '') AS department,
             start_time, end_time, status,
             COALESCE(decided_at, updated_at) AS recorded_at
      FROM approval_requests WHERE status IN ('APPROVED','REJECTED','ALTERNATIVE_SUGGESTED')
      ORDER BY decided_at ASC NULLS LAST
    `);

    let n2 = 0;
    for (const row of decided) {
      const eventType =
        row.status === 'APPROVED'             ? 'BookingApproved' :
        row.status === 'REJECTED'             ? 'BookingRejected' :
        'BookingAlternativeSuggested';
      const r = await analyticsPool.query(
        `INSERT INTO analytics_events
           (event_type, booking_id, resource_id, user_id, department, start_time, end_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (booking_id, event_type) DO NOTHING`,
        [eventType, row.booking_id, row.resource_id, row.user_id, row.department, row.start_time, row.end_time],
      );
      if ((r.rowCount ?? 0) > 0) n2++;
    }

    // ── 3. BookingCancelled — from booking engine ─────────────────────────────
    const { rows: cancelled } = await bookingPool.query(`
      SELECT id AS booking_id, resource_id, user_id,
             COALESCE(department, '') AS department,
             start_time, end_time
      FROM bookings WHERE status = 'CANCELLED' ORDER BY updated_at ASC
    `);

    let n3 = 0;
    for (const row of cancelled) {
      const r = await analyticsPool.query(
        `INSERT INTO analytics_events
           (event_type, booking_id, resource_id, user_id, department, start_time, end_time)
         VALUES ('BookingCancelled',$1,$2,$3,$4,$5,$6)
         ON CONFLICT (booking_id, event_type) DO NOTHING`,
        [row.booking_id, row.resource_id, row.user_id, row.department, row.start_time, row.end_time],
      );
      if ((r.rowCount ?? 0) > 0) n3++;
    }

    // ── 4. Rebuild utilisation_snapshots if empty ─────────────────────────────
    const { rows: snapCheck } = await analyticsPool.query(`SELECT COUNT(*) AS n FROM utilisation_snapshots`);
    if (parseInt(snapCheck[0].n, 10) === 0) {
      const { rows: approvedEvents } = await analyticsPool.query(
        `SELECT resource_id, department, start_time, end_time FROM analytics_events WHERE event_type = 'BookingApproved'`
      );
      for (const row of approvedEvents) {
        await upsertSnapshots(analyticsPool, row.resource_id, row.department,
          new Date(row.start_time), new Date(row.end_time), +1);
      }
    }

    logger.info({
      component: 'StartupBackfill', action: 'COMPLETE',
      submitted: n1, decided: n2, cancelled: n3,
    });

  } catch (err) {
    logger.warn({ component: 'StartupBackfill', action: 'SKIPPED', reason: (err as Error).message });
  } finally {
    await approvalPool.end().catch(() => {});
    await bookingPool.end().catch(() => {});
  }
}

function getHourSlots(start: Date, end: Date) {
  const slots: { hour: number; dayOfWeek: number; date: string }[] = [];
  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);
  while (cursor < end) {
    slots.push({ hour: cursor.getUTCHours(), dayOfWeek: cursor.getUTCDay(), date: cursor.toISOString().slice(0, 10) });
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return slots;
}

async function upsertSnapshots(pool: Pool, resourceId: string, department: string, start: Date, end: Date, delta: number) {
  for (const { hour, dayOfWeek, date } of getHourSlots(start, end)) {
    await pool.query(
      `INSERT INTO utilisation_snapshots (resource_id, department, hour, day_of_week, booking_count, snapshot_date, refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (resource_id, hour, day_of_week, snapshot_date)
       DO UPDATE SET booking_count = GREATEST(0, utilisation_snapshots.booking_count + $5), refreshed_at = NOW()`,
      [resourceId, department, hour, dayOfWeek, delta, date],
    );
  }
}
