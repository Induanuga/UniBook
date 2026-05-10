// src/services/HeatmapBuilder.ts
// Builds heatmap results from pre-aggregated utilisation snapshots (FR-7).
//
// Reads ONLY from utilisation_snapshots — never from transactional tables (NFR-1).
// Ensures analytics queries never compete with booking writes (ADR-001).

import type { AnalyticsRepository } from '../repositories/AnalyticsRepository';
import type { HeatmapResult } from '../types';
import { logger } from '../utils/logger';

export class HeatmapBuilder {
  constructor(private readonly repo: AnalyticsRepository) {}

  /**
   * Build a heatmap for the given date range.
   * Optionally scoped to a single resource or department.
   */
  async build(params: {
    from:        string;
    to:          string;
    resourceId?: string;
    department?: string;
  }): Promise<HeatmapResult> {
    const cells = await this.repo.getHeatmap(params);

    logger.info({
      component:  'HeatmapBuilder',
      action:     'BUILD',
      from:       params.from,
      to:         params.to,
      resourceId: params.resourceId,
      department: params.department,
      cellCount:  cells.length,
    });

    return {
      resourceId: params.resourceId,
      department: params.department,
      from:       params.from,
      to:         params.to,
      cells,
    };
  }
}
