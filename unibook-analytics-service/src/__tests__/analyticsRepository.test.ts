// src/__tests__/analyticsRepository.test.ts
// Unit tests for AnalyticsRepository — DB pool is mocked.

import { AnalyticsRepository } from '../repositories/AnalyticsRepository';
import type { AnalyticsEvent } from '../types';

function makeMockPool(rows: unknown[] = [], rowCount = 0) {
  return {
    query: jest.fn().mockResolvedValue({ rows, rowCount }),
  };
}

function makeEvent(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return {
    eventType:     'BookingApproved',
    correlationId: 'corr-1',
    bookingId:     'book-1',
    resourceId:    'res-1',
    userId:        'user-1',
    department:    'CS',
    startTime:     '2026-05-01T10:00:00.000Z',
    endTime:       '2026-05-01T12:00:00.000Z',
    timestamp:     new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => jest.clearAllMocks());

// ── insertEvent ───────────────────────────────────────────────────────────────

describe('AnalyticsRepository.insertEvent()', () => {
  test('executes INSERT with correct parameters', async () => {
    const pool = makeMockPool();
    const repo = new AnalyticsRepository(pool as never);
    const event = makeEvent();

    await repo.insertEvent(event);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO analytics_events');
    expect(params).toContain('BookingApproved');
    expect(params).toContain('book-1');
    expect(params).toContain('res-1');
    expect(params).toContain('CS');
  });
});

// ── upsertSnapshot ────────────────────────────────────────────────────────────

describe('AnalyticsRepository.upsertSnapshot()', () => {
  test('calls upsert once per hour slot in the booking window', async () => {
    const pool = makeMockPool();
    const repo = new AnalyticsRepository(pool as never);

    // 10:00 – 12:00 = 2 hour slots (10 and 11)
    await repo.upsertSnapshot(
      'res-1', 'CS',
      new Date('2026-05-01T10:00:00Z'),
      new Date('2026-05-01T12:00:00Z'),
      +1,
    );

    expect(pool.query).toHaveBeenCalledTimes(2);
    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO utilisation_snapshots');
    expect(sql).toContain('ON CONFLICT');
  });

  test('calls upsert once for a 1-hour booking', async () => {
    const pool = makeMockPool();
    const repo = new AnalyticsRepository(pool as never);

    await repo.upsertSnapshot(
      'res-1', 'CS',
      new Date('2026-05-01T09:00:00Z'),
      new Date('2026-05-01T10:00:00Z'),
      +1,
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

// ── getHeatmap ────────────────────────────────────────────────────────────────

describe('AnalyticsRepository.getHeatmap()', () => {
  test('returns mapped HeatmapCell array', async () => {
    const pool = makeMockPool([
      { hour: '10', day_of_week: '1', count: '5' },
      { hour: '11', day_of_week: '1', count: '3' },
    ]);
    const repo = new AnalyticsRepository(pool as never);

    const cells = await repo.getHeatmap({ from: '2026-05-01', to: '2026-05-31' });

    expect(cells).toHaveLength(2);
    expect(cells[0]).toEqual({ hour: 10, dayOfWeek: 1, count: 5 });
    expect(cells[1]).toEqual({ hour: 11, dayOfWeek: 1, count: 3 });
  });

  test('adds resourceId filter when provided', async () => {
    const pool = makeMockPool([]);
    const repo = new AnalyticsRepository(pool as never);

    await repo.getHeatmap({ from: '2026-05-01', to: '2026-05-31', resourceId: 'res-42' });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('resource_id');
    expect(params).toContain('res-42');
  });

  test('adds department filter when provided', async () => {
    const pool = makeMockPool([]);
    const repo = new AnalyticsRepository(pool as never);

    await repo.getHeatmap({ from: '2026-05-01', to: '2026-05-31', department: 'Physics' });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('department');
    expect(params).toContain('Physics');
  });
});

// ── getSummary ────────────────────────────────────────────────────────────────

describe('AnalyticsRepository.getSummary()', () => {
  test('maps event_type rows to summary fields', async () => {
    const pool = makeMockPool([
      { event_type: 'BookingApproved',  count: '10' },
      { event_type: 'BookingCancelled', count: '2'  },
      { event_type: 'BookingSubmitted', count: '15' },
      { event_type: 'BookingRejected',  count: '3'  },
    ]);
    const repo = new AnalyticsRepository(pool as never);

    const summary = await repo.getSummary({ from: '2026-05-01', to: '2026-05-31' });

    expect(summary.totalApproved).toBe(10);
    expect(summary.totalCancelled).toBe(2);
    expect(summary.totalSubmitted).toBe(15);
    expect(summary.totalRejected).toBe(3);
  });

  test('defaults missing event types to 0', async () => {
    const pool = makeMockPool([
      { event_type: 'BookingApproved', count: '7' },
    ]);
    const repo = new AnalyticsRepository(pool as never);

    const summary = await repo.getSummary({ from: '2026-05-01', to: '2026-05-31' });

    expect(summary.totalApproved).toBe(7);
    expect(summary.totalCancelled).toBe(0);
    expect(summary.totalSubmitted).toBe(0);
    expect(summary.totalRejected).toBe(0);
  });
});

// ── getEventsForExport ────────────────────────────────────────────────────────

describe('AnalyticsRepository.getEventsForExport()', () => {
  test('returns mapped AnalyticsEventRow array', async () => {
    const now = new Date();
    const pool = makeMockPool([
      {
        id:           'evt-1',
        event_type:   'BookingApproved',
        booking_id:   'book-1',
        resource_id:  'res-1',
        user_id:      'user-1',
        department:   'CS',
        start_time:   now,
        end_time:     now,
        recorded_at:  now,
      },
    ]);
    const repo = new AnalyticsRepository(pool as never);

    const rows = await repo.getEventsForExport({ from: '2026-05-01', to: '2026-05-31' });

    expect(rows).toHaveLength(1);
    expect(rows[0].eventType).toBe('BookingApproved');
    expect(rows[0].bookingId).toBe('book-1');
  });

  test('returns empty array when no events found', async () => {
    const pool = makeMockPool([]);
    const repo = new AnalyticsRepository(pool as never);

    const rows = await repo.getEventsForExport({ from: '2026-05-01', to: '2026-05-31' });

    expect(rows).toHaveLength(0);
  });
});
