// src/services/ReportExporter.ts
// Generates CSV exports of raw analytics events for admin download (FR-7).
//
// Reads from analytics_events over a custom date range.
// Serialises rows to RFC 4180 CSV — no external library needed.

import type { AnalyticsRepository } from '../repositories/AnalyticsRepository';
import { logger } from '../utils/logger';

const CSV_HEADERS = [
  'id',
  'eventType',
  'bookingId',
  'resourceId',
  'userId',
  'department',
  'startTime',
  'endTime',
  'recordedAt',
].join(',');

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export class ReportExporter {
  constructor(private readonly repo: AnalyticsRepository) {}

  /**
   * Export analytics events as a CSV string.
   * Returns the full CSV content (headers + rows).
   */
  async exportCsv(params: {
    from:        string;
    to:          string;
    resourceId?: string;
    department?: string;
  }): Promise<string> {
    const rows = await this.repo.getEventsForExport(params);

    const lines = rows.map((r) =>
      [
        r.id,
        r.eventType,
        r.bookingId,
        r.resourceId,
        r.userId,
        escapeCsv(r.department),
        r.startTime.toISOString(),
        r.endTime.toISOString(),
        r.recordedAt.toISOString(),
      ].join(','),
    );

    logger.info({
      component:  'ReportExporter',
      action:     'EXPORT_CSV',
      from:       params.from,
      to:         params.to,
      rowCount:   rows.length,
    });

    return [CSV_HEADERS, ...lines].join('\n');
  }
}
