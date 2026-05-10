// src/services/FreshnessGuard.ts
// NFR-1 — Performance / Data Freshness
//
// "Dashboard data must reflect state as of the last 5 minutes." (FR-7, NFR-1)
// "Aggregation queries must not compete with transactional booking queries,
//  mandating a read-side materialised view model." (Architecture Report, FR-7)
//
// Mechanism:
//   - utilisation_snapshots rows carry a refreshed_at timestamp updated on every
//     upsert by UtilisationAggregator.
//   - FreshnessGuard.check() queries the MAX(refreshed_at) across all snapshots
//     and compares it to NOW() - STALE_THRESHOLD_MS.
//   - If the most recent snapshot is older than the threshold, the guard returns
//     a FreshnessStatus with isFresh = false and the staleness age in seconds.
//   - AnalyticsService exposes getFreshnessStatus() so the /analytics/summary
//     and /analytics/heatmap routes can include a freshness header in responses.
//   - The guard itself never touches analytics_events or booking tables (NFR-1).
//
// Design patterns:
//   - Repository: all SQL isolated in AnalyticsRepository (injected).
//   - Facade: AnalyticsService is the only caller — guard is an internal concern.

import type { AnalyticsRepository } from '../repositories/AnalyticsRepository';
import { logger } from '../utils/logger';

export const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes (NFR-1)

export interface FreshnessStatus {
  isFresh: boolean;
  lastRefreshedAt: Date | null;
  ageSeconds: number | null;
  thresholdSeconds: number;
}

export class FreshnessGuard {
  constructor(
    private readonly repo: AnalyticsRepository,
    private readonly thresholdMs: number = STALE_THRESHOLD_MS,
  ) {}

  /**
   * Check whether the utilisation_snapshots materialised view is fresh.
   * Returns a FreshnessStatus describing the current state.
   *
   * isFresh = true  → most recent snapshot was refreshed within thresholdMs.
   * isFresh = false → snapshots are stale (or no snapshots exist yet).
   */
  async check(): Promise<FreshnessStatus> {
    const lastRefreshedAt = await this.repo.getLastSnapshotRefreshedAt();
    const thresholdSeconds = this.thresholdMs / 1000;

    if (!lastRefreshedAt) {
      logger.warn({ component: 'FreshnessGuard', action: 'NO_SNAPSHOTS' });
      return { isFresh: false, lastRefreshedAt: null, ageSeconds: null, thresholdSeconds };
    }

    const ageMs = Date.now() - lastRefreshedAt.getTime();
    const ageSeconds = Math.floor(ageMs / 1000);
    const isFresh = ageMs <= this.thresholdMs;

    if (!isFresh) {
      logger.warn({
        component: 'FreshnessGuard',
        action: 'STALE_SNAPSHOTS',
        ageSeconds,
        thresholdSeconds,
        lastRefreshedAt: lastRefreshedAt.toISOString(),
      });
    }

    return { isFresh, lastRefreshedAt, ageSeconds, thresholdSeconds };
  }
}
