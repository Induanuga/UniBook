// src/__tests__/analyticsService.test.ts
// Unit tests for AnalyticsService — all DB interactions mocked.

import { AnalyticsService } from '../services/AnalyticsService';
import type { AnalyticsEvent } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockPool() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

function makeEvent(
  eventType: AnalyticsEvent['eventType'] = 'BookingApproved',
  overrides: Partial<AnalyticsEvent> = {},
): AnalyticsEvent {
  return {
    eventType,
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

// ── processEvent ──────────────────────────────────────────────────────────────

describe('AnalyticsService.processEvent()', () => {
  test('inserts event and increments snapshot for BookingApproved', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    const insertSpy    = jest.fn().mockResolvedValue(undefined);
    const upsertSpy    = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.insertEvent   = insertSpy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.upsertSnapshot = upsertSpy;

    await service.processEvent(makeEvent('BookingApproved'));

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith(
      'res-1', 'CS',
      expect.any(Date), expect.any(Date),
      +1,
    );
  });

  test('inserts event and decrements snapshot for BookingCancelled', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    const insertSpy  = jest.fn().mockResolvedValue(undefined);
    const upsertSpy  = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.insertEvent    = insertSpy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.upsertSnapshot = upsertSpy;

    await service.processEvent(makeEvent('BookingCancelled'));

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith(
      'res-1', 'CS',
      expect.any(Date), expect.any(Date),
      -1,
    );
  });

  test('inserts event but does NOT upsert snapshot for BookingSubmitted', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    const insertSpy  = jest.fn().mockResolvedValue(undefined);
    const upsertSpy  = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.insertEvent    = insertSpy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.upsertSnapshot = upsertSpy;

    await service.processEvent(makeEvent('BookingSubmitted'));

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  test('inserts event but does NOT upsert snapshot for BookingRejected', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    const insertSpy  = jest.fn().mockResolvedValue(undefined);
    const upsertSpy  = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.insertEvent    = insertSpy;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.upsertSnapshot = upsertSpy;

    await service.processEvent(makeEvent('BookingRejected'));

    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

// ── getHeatmap ────────────────────────────────────────────────────────────────

describe('AnalyticsService.getHeatmap()', () => {
  test('delegates to HeatmapBuilder and returns result', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    const mockCells = [{ hour: 10, dayOfWeek: 1, count: 5 }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.getHeatmap = jest.fn().mockResolvedValue(mockCells);

    const result = await service.getHeatmap({ from: '2026-05-01', to: '2026-05-31' });

    expect(result.cells).toEqual(mockCells);
    expect(result.from).toBe('2026-05-01');
    expect(result.to).toBe('2026-05-31');
  });

  test('passes resourceId filter through to repository', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    const getHeatmapSpy = jest.fn().mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.getHeatmap = getHeatmapSpy;

    await service.getHeatmap({ from: '2026-05-01', to: '2026-05-31', resourceId: 'res-42' });

    expect(getHeatmapSpy).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'res-42' }),
    );
  });
});

// ── getSummary ────────────────────────────────────────────────────────────────

describe('AnalyticsService.getSummary()', () => {
  test('returns summary with correct counts', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    const mockSummary = {
      totalApproved: 10, totalCancelled: 2,
      totalSubmitted: 15, totalRejected: 3,
      from: '2026-05-01', to: '2026-05-31',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.getSummary = jest.fn().mockResolvedValue(mockSummary);

    const result = await service.getSummary({ from: '2026-05-01', to: '2026-05-31' });

    expect(result.totalApproved).toBe(10);
    expect(result.totalCancelled).toBe(2);
  });
});

// ── exportCsv ─────────────────────────────────────────────────────────────────

describe('AnalyticsService.exportCsv()', () => {
  test('returns CSV string with headers', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.getEventsForExport = jest.fn().mockResolvedValue([
      {
        id:         'evt-1',
        eventType:  'BookingApproved',
        bookingId:  'book-1',
        resourceId: 'res-1',
        userId:     'user-1',
        department: 'CS',
        startTime:  new Date('2026-05-01T10:00:00Z'),
        endTime:    new Date('2026-05-01T12:00:00Z'),
        recordedAt: new Date('2026-05-01T10:05:00Z'),
      },
    ]);

    const csv = await service.exportCsv({ from: '2026-05-01', to: '2026-05-31' });

    expect(csv).toContain('id,eventType,bookingId');
    expect(csv).toContain('BookingApproved');
    expect(csv).toContain('evt-1');
  });

  test('returns only headers when no events found', async () => {
    const pool = makeMockPool();
    const service = new AnalyticsService(pool as never);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo.getEventsForExport = jest.fn().mockResolvedValue([]);

    const csv = await service.exportCsv({ from: '2026-05-01', to: '2026-05-31' });

    const lines = csv.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);   // header only
    expect(lines[0]).toContain('id,eventType');
  });
});
