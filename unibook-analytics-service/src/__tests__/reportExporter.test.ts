// src/__tests__/reportExporter.test.ts
// Unit tests for ReportExporter — repository is mocked.

import { ReportExporter } from '../services/ReportExporter';

function makeMockRepo(rows: unknown[] = []) {
  return {
    getEventsForExport: jest.fn().mockResolvedValue(rows),
  };
}

afterEach(() => jest.clearAllMocks());

describe('ReportExporter.exportCsv()', () => {
  test('returns CSV with header row', async () => {
    const repo     = makeMockRepo([]);
    const exporter = new ReportExporter(repo as never);

    const csv = await exporter.exportCsv({ from: '2026-05-01', to: '2026-05-31' });

    expect(csv.startsWith('id,eventType,bookingId')).toBe(true);
  });

  test('includes one data row per event', async () => {
    const now  = new Date('2026-05-01T10:00:00Z');
    const repo = makeMockRepo([
      {
        id:         'evt-1',
        eventType:  'BookingApproved',
        bookingId:  'book-1',
        resourceId: 'res-1',
        userId:     'user-1',
        department: 'CS',
        startTime:  now,
        endTime:    now,
        recordedAt: now,
      },
      {
        id:         'evt-2',
        eventType:  'BookingCancelled',
        bookingId:  'book-2',
        resourceId: 'res-2',
        userId:     'user-2',
        department: 'Physics',
        startTime:  now,
        endTime:    now,
        recordedAt: now,
      },
    ]);
    const exporter = new ReportExporter(repo as never);

    const csv   = await exporter.exportCsv({ from: '2026-05-01', to: '2026-05-31' });
    const lines = csv.split('\n').filter(Boolean);

    expect(lines).toHaveLength(3);   // header + 2 data rows
    expect(lines[1]).toContain('BookingApproved');
    expect(lines[2]).toContain('BookingCancelled');
  });

  test('escapes commas in department field', async () => {
    const now  = new Date('2026-05-01T10:00:00Z');
    const repo = makeMockRepo([
      {
        id:         'evt-1',
        eventType:  'BookingApproved',
        bookingId:  'book-1',
        resourceId: 'res-1',
        userId:     'user-1',
        department: 'Science, Tech',   // contains comma
        startTime:  now,
        endTime:    now,
        recordedAt: now,
      },
    ]);
    const exporter = new ReportExporter(repo as never);

    const csv = await exporter.exportCsv({ from: '2026-05-01', to: '2026-05-31' });

    expect(csv).toContain('"Science, Tech"');
  });

  test('passes filters to repository', async () => {
    const repo     = makeMockRepo([]);
    const exporter = new ReportExporter(repo as never);

    await exporter.exportCsv({
      from:       '2026-05-01',
      to:         '2026-05-31',
      resourceId: 'res-42',
      department: 'Physics',
    });

    expect(repo.getEventsForExport).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'res-42', department: 'Physics' }),
    );
  });
});
