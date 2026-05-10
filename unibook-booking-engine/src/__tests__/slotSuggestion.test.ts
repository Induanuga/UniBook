// src/__tests__/slotSuggestion.test.ts
// Unit tests for SlotSuggestionService (FR-4: 3 nearest available slots within 7 days).

import { SlotSuggestionService } from '../services/SlotSuggestionService';

const BASE = new Date('2026-05-01T10:00:00Z');
const PLUS1H = new Date('2026-05-01T11:00:00Z');

function makePool(rows: object[]) {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  };
}

describe('SlotSuggestionService', () => {
  test('returns 3 suggestions when resource is completely free', async () => {
    const pool    = makePool([]);  // no existing bookings
    const service = new SlotSuggestionService(pool as never);

    const suggestions = await service.findNextAvailable('res-1', BASE, PLUS1H);
    expect(suggestions).toHaveLength(3);
  });

  test('suggestion start times are 15-minute aligned', async () => {
    const pool    = makePool([]);
    const service = new SlotSuggestionService(pool as never);
    const suggestions = await service.findNextAvailable('res-1', BASE, PLUS1H);

    for (const s of suggestions) {
      const minutes = new Date(s.startTime).getMinutes();
      expect(minutes % 15).toBe(0);
    }
  });

  test('each suggestion has same duration as requested window', async () => {
    const pool        = makePool([]);
    const service     = new SlotSuggestionService(pool as never);
    const durationMs  = PLUS1H.getTime() - BASE.getTime();

    const suggestions = await service.findNextAvailable('res-1', BASE, PLUS1H);
    for (const s of suggestions) {
      const d = new Date(s.endTime).getTime() - new Date(s.startTime).getTime();
      expect(d).toBe(durationMs);
    }
  });

  test('skips over a busy slot and returns next free ones', async () => {
    // Block the first hour
    const busyRow = {
      start_time: BASE.toISOString(),
      end_time:   PLUS1H.toISOString(),
    };
    const pool    = makePool([busyRow]);
    const service = new SlotSuggestionService(pool as never);

    const suggestions = await service.findNextAvailable('res-1', BASE, PLUS1H);

    // All suggestions must start at or after the blocker ends
    for (const s of suggestions) {
      expect(new Date(s.startTime).getTime()).toBeGreaterThanOrEqual(PLUS1H.getTime());
    }
    expect(suggestions).toHaveLength(3);
  });

  test('returns fewer than 3 when look-ahead window is exhausted', async () => {
    // Fill the entire 7-day window with one giant booking
    const bigBlock = {
      start_time: BASE.toISOString(),
      end_time:   new Date(BASE.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const pool    = makePool([bigBlock]);
    const service = new SlotSuggestionService(pool as never);

    const suggestions = await service.findNextAvailable('res-1', BASE, PLUS1H);
    expect(suggestions.length).toBeLessThan(3);
  });

  test('suggestions are in chronological order', async () => {
    const pool    = makePool([]);
    const service = new SlotSuggestionService(pool as never);
    const suggestions = await service.findNextAvailable('res-1', BASE, PLUS1H);

    for (let i = 1; i < suggestions.length; i++) {
      expect(new Date(suggestions[i].startTime).getTime())
        .toBeGreaterThan(new Date(suggestions[i - 1].startTime).getTime());
    }
  });
});
