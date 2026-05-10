// src/services/UtilisationAggregator.ts
// Maintains the utilisation_snapshots materialised view model (FR-7, NFR-1).
//
// increment() — called when a booking is approved (+1 per covered hour slot).
// decrement() — called when a booking is cancelled (-1 per covered hour slot).
//
// Snapshots are pre-aggregated so heatmap queries never touch the raw event log
// or the transactional booking tables, satisfying NFR-1 (P95 <= 500 ms).

import type { AnalyticsRepository } from '../repositories/AnalyticsRepository';
import { logger } from '../utils/logger';

export class UtilisationAggregator {
  constructor(private readonly repo: AnalyticsRepository) {}

  /** Increment snapshot counts for every hour slot in the booking window. */
  async increment(
    resourceId: string,
    department: string,
    startTime:  Date,
    endTime:    Date,
  ): Promise<void> {
    await this.repo.upsertSnapshot(resourceId, department, startTime, endTime, +1);
    logger.info({
      component:  'UtilisationAggregator',
      action:     'INCREMENT',
      resourceId,
      department,
      startTime:  startTime.toISOString(),
      endTime:    endTime.toISOString(),
    });
  }

  /** Decrement snapshot counts (floor at 0) for every hour slot in the booking window. */
  async decrement(
    resourceId: string,
    department: string,
    startTime:  Date,
    endTime:    Date,
  ): Promise<void> {
    await this.repo.upsertSnapshot(resourceId, department, startTime, endTime, -1);
    logger.info({
      component:  'UtilisationAggregator',
      action:     'DECREMENT',
      resourceId,
      department,
      startTime:  startTime.toISOString(),
      endTime:    endTime.toISOString(),
    });
  }
}
