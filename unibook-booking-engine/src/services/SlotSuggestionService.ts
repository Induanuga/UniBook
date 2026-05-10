// src/services/SlotSuggestionService.ts
// FR-4: On conflict, return the three nearest available slots within 7 days.
// Queries the DB for existing bookings and walks forward to find free windows.

import { Pool } from 'pg';
import { config } from '../config';
import type { SlotSuggestion } from '../types';
import { logger } from '../utils/logger';

export class SlotSuggestionService {
  constructor(private readonly db: Pool) {}

  /**
   * Find up to `count` available slots for a resource starting from `after`.
   * Slots have the same duration as the originally-requested window.
   * Slots are aligned to 15-minute boundaries (FR-1: 15-min granularity).
   */
  async findNextAvailable(
    resourceId:    string,
    requestedStart: Date,
    requestedEnd:   Date,
    correlationId?: string,
  ): Promise<SlotSuggestion[]> {
    const durationMs = requestedEnd.getTime() - requestedStart.getTime();
    const count      = config.conflict.suggestionCount;
    const cutoff     = new Date(
      requestedStart.getTime() + config.conflict.lookAheadDays * 24 * 60 * 60 * 1000,
    );

    // Fetch all active bookings for this resource within the look-ahead window
    const result = await this.db.query(
      `SELECT start_time, end_time FROM bookings
       WHERE resource_id = $1
         AND status IN ('PENDING','APPROVED')
         AND end_time > $2
         AND start_time < $3
       ORDER BY start_time ASC`,
      [resourceId, requestedStart.toISOString(), cutoff.toISOString()],
    );

    const busy: Array<{ start: Date; end: Date }> = result.rows.map((r) => ({
      start: new Date(r.start_time as string),
      end:   new Date(r.end_time as string),
    }));

    const suggestions: SlotSuggestion[] = [];
    // Start scanning from the originally-requested start time, aligned to 15 min
    let cursor = align15(requestedStart);

    while (suggestions.length < count && cursor < cutoff) {
      const candidateEnd = new Date(cursor.getTime() + durationMs);

      const overlaps = busy.some(
        (b) => b.start < candidateEnd && b.end > cursor,
      );

      if (!overlaps) {
        suggestions.push({
          startTime: cursor.toISOString(),
          endTime:   candidateEnd.toISOString(),
        });
        // Skip past this candidate to find the next distinct slot
        cursor = align15(new Date(candidateEnd.getTime()));
      } else {
        // Jump cursor to end of the blocking booking
        const blocker = busy.find((b) => b.start < candidateEnd && b.end > cursor);
        cursor = align15(blocker!.end);
      }
    }

    logger.info({
      correlationId,
      component:   'SlotSuggestionService',
      action:      'SUGGESTIONS_COMPUTED',
      resourceId,
      count:       suggestions.length,
    });

    return suggestions;
  }
}

/** Round a date UP to the next 15-minute boundary. */
function align15(d: Date): Date {
  const ms   = 15 * 60 * 1000;
  const rem  = d.getTime() % ms;
  if (rem === 0) return d;
  return new Date(d.getTime() - rem + ms);
}
