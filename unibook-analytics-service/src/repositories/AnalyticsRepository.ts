// src/repositories/AnalyticsRepository.ts
// Repository pattern — owns all SQL for analytics_events and utilisation_snapshots.
//
// Date filter semantics: all queries filter by start_time (the booking slot date),
// NOT recorded_at. This means "From Apr 22 To Apr 23" returns bookings whose
// slot falls in that range, matching what users see in My Bookings.

import type { Pool } from 'pg';
import type {
  AnalyticsEvent,
  AnalyticsEventRow,
  HeatmapCell,
  AnalyticsSummary,
} from '../types';
import { logger } from '../utils/logger';

interface EventRow {
  id:          string;
  event_type:  string;
  booking_id:  string;
  resource_id: string;
  user_id:     string;
  department:  string;
  start_time:  Date;
  end_time:    Date;
  recorded_at: Date;
}

interface SummaryRow {
  event_type: string;
  count:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface HourSlot { hour: number; dayOfWeek: number; date: string; }

function getHourSlots(start: Date, end: Date): HourSlot[] {
  const slots: HourSlot[] = [];
  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);
  while (cursor < end) {
    slots.push({ hour: cursor.getUTCHours(), dayOfWeek: cursor.getUTCDay(), date: cursor.toISOString().slice(0, 10) });
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return slots;
}

/**
 * Build a department WHERE clause.
 * Empty string in DB = user had no department set = "Others".
 * Returns the clause string and optionally the value to bind.
 */
function deptCondition(dept: string, idx: number): { clause: string; value?: string } {
  if (dept === 'Others') {
    return { clause: `(department = '' OR department IS NULL)` };
  }
  return { clause: `department = $${idx}`, value: dept };
}

// ── Repository ────────────────────────────────────────────────────────────────

export class AnalyticsRepository {
  constructor(private readonly db: Pool) {}

  // ── Write ──────────────────────────────────────────────────────────────────

  async insertEvent(event: AnalyticsEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO analytics_events
         (event_type, booking_id, resource_id, user_id, department, start_time, end_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (booking_id, event_type) DO NOTHING`,
      [event.eventType, event.bookingId, event.resourceId,
       event.userId, event.department, event.startTime, event.endTime],
    );
    logger.info({ component: 'AnalyticsRepository', action: 'EVENT_INSERTED', eventType: event.eventType, bookingId: event.bookingId });
  }

  async upsertSnapshot(resourceId: string, department: string, startTime: Date, endTime: Date, delta: number): Promise<void> {
    for (const { hour, dayOfWeek, date } of getHourSlots(startTime, endTime)) {
      await this.db.query(
        `INSERT INTO utilisation_snapshots
           (resource_id, department, hour, day_of_week, booking_count, snapshot_date, refreshed_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (resource_id, hour, day_of_week, snapshot_date)
         DO UPDATE SET booking_count = GREATEST(0, utilisation_snapshots.booking_count + $5), refreshed_at = NOW()`,
        [resourceId, department, hour, dayOfWeek, delta, date],
      );
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Heatmap — reads from utilisation_snapshots.
   * snapshot_date is the UTC date of the booking slot, so date filter is correct.
   */
  async getHeatmap(params: { from: string; to: string; resourceId?: string; department?: string }): Promise<HeatmapCell[]> {
    const conditions: string[] = ['snapshot_date >= $1', 'snapshot_date <= $2'];
    const values: unknown[] = [params.from, params.to];
    let idx = 3;

    if (params.resourceId) {
      conditions.push(`resource_id = $${idx++}`);
      values.push(params.resourceId);
    }
    if (params.department) {
      const { clause, value } = deptCondition(params.department, idx);
      conditions.push(clause);
      if (value !== undefined) { values.push(value); idx++; }
    }

    const result = await this.db.query<{ hour: number; day_of_week: number; count: string }>(
      `SELECT hour, day_of_week, SUM(booking_count) AS count
       FROM utilisation_snapshots
       WHERE ${conditions.join(' AND ')}
       GROUP BY hour, day_of_week
       ORDER BY day_of_week, hour`,
      values,
    );

    return result.rows.map((r) => ({
      hour:      Number(r.hour),
      dayOfWeek: Number(r.day_of_week),
      count:     parseInt(r.count, 10),
    }));
  }

  /**
   * Summary counts — filters by start_time (slot date) so the date range
   * matches what users see in My Bookings (booking for Apr 27 = Apr 27 range).
   */
  async getSummary(params: { from: string; to: string; department?: string; resourceId?: string }): Promise<AnalyticsSummary> {
    const conditions: string[] = [
      `start_time >= $1::date`,
      `start_time < ($2::date + INTERVAL '1 day')`,
    ];
    const values: unknown[] = [params.from, params.to];
    let idx = 3;

    if (params.department) {
      const { clause, value } = deptCondition(params.department, idx);
      conditions.push(clause);
      if (value !== undefined) { values.push(value); idx++; }
    }
    if (params.resourceId) {
      conditions.push(`resource_id = $${idx++}`);
      values.push(params.resourceId);
    }

    const result = await this.db.query<SummaryRow>(
      `SELECT event_type, COUNT(*) AS count
       FROM analytics_events
       WHERE ${conditions.join(' AND ')}
       GROUP BY event_type`,
      values,
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) counts[row.event_type] = parseInt(row.count, 10);

    return {
      totalApproved:             counts['BookingApproved']             ?? 0,
      totalCancelled:            counts['BookingCancelled']            ?? 0,
      totalSubmitted:            counts['BookingSubmitted']            ?? 0,
      totalRejected:             counts['BookingRejected']             ?? 0,
      totalAlternativeSuggested: counts['BookingAlternativeSuggested'] ?? 0,
      from: params.from,
      to:   params.to,
    };
  }

  /**
   * NFR-1 Freshness — returns the most recent refreshed_at across all snapshots.
   * Used by FreshnessGuard to determine whether the materialised view is stale.
   * Returns null if no snapshots exist yet.
   */
  async getLastSnapshotRefreshedAt(): Promise<Date | null> {
    const result = await this.db.query<{ last_refreshed: Date | null }>(
      `SELECT MAX(refreshed_at) AS last_refreshed FROM utilisation_snapshots`,
    );
    return result.rows[0]?.last_refreshed ?? null;
  }

  /**
   * CSV export — also filters by start_time for consistency.
   */
  async getEventsForExport(params: { from: string; to: string; resourceId?: string; department?: string }): Promise<AnalyticsEventRow[]> {
    const conditions: string[] = [
      `start_time >= $1::date`,
      `start_time < ($2::date + INTERVAL '1 day')`,
    ];
    const values: unknown[] = [params.from, params.to];
    let idx = 3;

    if (params.resourceId) {
      conditions.push(`resource_id = $${idx++}`);
      values.push(params.resourceId);
    }
    if (params.department) {
      const { clause, value } = deptCondition(params.department, idx);
      conditions.push(clause);
      if (value !== undefined) { values.push(value); idx++; }
    }

    const result = await this.db.query<EventRow>(
      `SELECT id, event_type, booking_id, resource_id, user_id,
              department, start_time, end_time, recorded_at
       FROM analytics_events
       WHERE ${conditions.join(' AND ')}
       ORDER BY start_time ASC`,
      values,
    );
    return result.rows.map((r) => ({
      id:         r.id,
      eventType:  r.event_type,
      bookingId:  r.booking_id,
      resourceId: r.resource_id,
      userId:     r.user_id,
      department: r.department,
      startTime:  r.start_time,
      endTime:    r.end_time,
      recordedAt: r.recorded_at,
    }));
  }
}
