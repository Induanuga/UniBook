// src/db/backfill.ts
// One-time backfill — seeds analytics_events from approval workflow + booking engine DBs.
// Idempotent: safe to run multiple times.
// Run: npm run db:backfill

import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const ANALYTICS_DB_URL = process.env.DATABASE_URL!;
const APPROVAL_DB_URL  = process.env.APPROVAL_DATABASE_URL || ANALYTICS_DB_URL.replace('unibook_analytics', 'unibook_approval');
const BOOKING_DB_URL   = process.env.BOOKING_DATABASE_URL  || ANALYTICS_DB_URL.replace('unibook_analytics', 'unibook_booking');

async function backfill(): Promise<void> {
  const analyticsPool = new Pool({ connectionString: ANALYTICS_DB_URL });
  const approvalPool  = new Pool({ connectionString: APPROVAL_DB_URL });
  const bookingPool   = new Pool({ connectionString: BOOKING_DB_URL });

  console.log('[Backfill] Analytics DB:', ANALYTICS_DB_URL.replace(/:[^:@]+@/, ':***@'));
  console.log('[Backfill] Approval DB: ', APPROVAL_DB_URL.replace(/:[^:@]+@/, ':***@'));
  console.log('[Backfill] Booking DB:  ', BOOKING_DB_URL.replace(/:[^:@]+@/, ':***@'));

  try {
    // ── 1. BookingSubmitted ───────────────────────────────────────────────────
    const { rows: allRows } = await approvalPool.query(`
      SELECT booking_id, resource_id, requester_id AS user_id,
             COALESCE(department,'') AS department, start_time, end_time
      FROM approval_requests ORDER BY created_at ASC
    `);
    console.log(`\n[1] BookingSubmitted — ${allRows.length} booking(s)`);
    let n1 = 0;
    for (const row of allRows) {
      const r = await analyticsPool.query(
        `INSERT INTO analytics_events (event_type, booking_id, resource_id, user_id, department, start_time, end_time)
         VALUES ('BookingSubmitted',$1,$2,$3,$4,$5,$6)
         ON CONFLICT (booking_id, event_type) DO NOTHING`,
        [row.booking_id, row.resource_id, row.user_id, row.department, row.start_time, row.end_time],
      );
      if ((r.rowCount ?? 0) > 0) { n1++; console.log(`  ✓ BookingSubmitted  ${row.booking_id}`); }
      else console.log(`  – exists           BookingSubmitted ${row.booking_id}`);
    }
    console.log(`  → inserted: ${n1}`);

    // ── 2. BookingApproved / BookingRejected ──────────────────────────────────
    const { rows: decidedRows } = await approvalPool.query(`
      SELECT booking_id, resource_id, requester_id AS user_id,
             COALESCE(department,'') AS department, start_time, end_time, status
      FROM approval_requests WHERE status IN ('APPROVED','REJECTED','ALTERNATIVE_SUGGESTED')
      ORDER BY decided_at ASC NULLS LAST
    `);
    console.log(`\n[2] Decisions — ${decidedRows.length} decided booking(s)`);
    let n2 = 0;
    for (const row of decidedRows) {
      const eventType =
        row.status === 'APPROVED'             ? 'BookingApproved' :
        row.status === 'REJECTED'             ? 'BookingRejected' :
        'BookingAlternativeSuggested';
      const r = await analyticsPool.query(
        `INSERT INTO analytics_events (event_type, booking_id, resource_id, user_id, department, start_time, end_time)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (booking_id, event_type) DO NOTHING`,
        [eventType, row.booking_id, row.resource_id, row.user_id, row.department, row.start_time, row.end_time],
      );
      if ((r.rowCount ?? 0) > 0) { n2++; console.log(`  ✓ ${eventType.padEnd(18)} ${row.booking_id}`); }
      else console.log(`  – exists           ${eventType} ${row.booking_id}`);
    }
    console.log(`  → inserted: ${n2}`);

    // ── 3. BookingCancelled ───────────────────────────────────────────────────
    const { rows: cancelledRows } = await bookingPool.query(`
      SELECT id AS booking_id, resource_id, user_id,
             COALESCE(department,'') AS department, start_time, end_time
      FROM bookings WHERE status = 'CANCELLED' ORDER BY updated_at ASC
    `);
    console.log(`\n[3] BookingCancelled — ${cancelledRows.length} cancelled booking(s)`);
    let n3 = 0;
    for (const row of cancelledRows) {
      const r = await analyticsPool.query(
        `INSERT INTO analytics_events (event_type, booking_id, resource_id, user_id, department, start_time, end_time)
         VALUES ('BookingCancelled',$1,$2,$3,$4,$5,$6)
         ON CONFLICT (booking_id, event_type) DO NOTHING`,
        [row.booking_id, row.resource_id, row.user_id, row.department, row.start_time, row.end_time],
      );
      if ((r.rowCount ?? 0) > 0) { n3++; console.log(`  ✓ BookingCancelled  ${row.booking_id}`); }
      else console.log(`  – exists           BookingCancelled ${row.booking_id}`);
    }
    console.log(`  → inserted: ${n3}`);

    // ── 4. Rebuild utilisation_snapshots ─────────────────────────────────────
    console.log('\n[4] Rebuilding utilisation_snapshots...');
    await analyticsPool.query('DELETE FROM utilisation_snapshots');
    const { rows: approvedEvents } = await analyticsPool.query(
      `SELECT resource_id, department, start_time, end_time FROM analytics_events WHERE event_type = 'BookingApproved'`
    );
    let snapCount = 0;
    for (const row of approvedEvents) {
      const slots = getHourSlots(new Date(row.start_time), new Date(row.end_time));
      for (const { hour, dayOfWeek, date } of slots) {
        await analyticsPool.query(
          `INSERT INTO utilisation_snapshots (resource_id, department, hour, day_of_week, booking_count, snapshot_date, refreshed_at)
           VALUES ($1,$2,$3,$4,1,$5,NOW())
           ON CONFLICT (resource_id, hour, day_of_week, snapshot_date)
           DO UPDATE SET booking_count = utilisation_snapshots.booking_count + 1, refreshed_at = NOW()`,
          [row.resource_id, row.department, hour, dayOfWeek, date],
        );
        snapCount++;
      }
    }
    console.log(`  → ${snapCount} snapshot slot(s) for ${approvedEvents.length} approved booking(s)`);

    // ── Summary ───────────────────────────────────────────────────────────────
    const { rows: counts } = await analyticsPool.query(
      `SELECT event_type, COUNT(*) AS n FROM analytics_events GROUP BY event_type ORDER BY event_type`
    );
    console.log('\n[Backfill] Final analytics_events:');
    for (const c of counts) console.log(`  ${c.event_type.padEnd(20)} ${c.n}`);
    console.log('\n[Backfill] Complete ✓');

  } catch (err) {
    console.error('[Backfill] Failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await analyticsPool.end();
    await approvalPool.end();
    await bookingPool.end();
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

backfill();
