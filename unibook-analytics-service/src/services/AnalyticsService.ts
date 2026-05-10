// src/services/AnalyticsService.ts
// Facade — single public entry point for the Analytics subsystem (Facade pattern).
//
// Wires together:
//   - AnalyticsEventConsumer  (Observer — ingests events)
//   - UtilisationAggregator   (maintains materialised snapshots)
//   - HeatmapBuilder          (reads snapshots for heatmap queries)
//   - ReportExporter          (CSV export from raw event log)
//   - FreshnessGuard          (NFR-1 — enforces 5-minute data freshness SLA)
//   - AnalyticsRepository     (all SQL)
//
// Routes and the internal webhook handler call only this class.
// If the internal orchestration changes, only this file changes — not the API contract.

import type { Pool } from 'pg';
import type { AnalyticsEvent, HeatmapResult, AnalyticsSummary } from '../types';
import { AnalyticsRepository }    from '../repositories/AnalyticsRepository';
import { AnalyticsEventConsumer } from './AnalyticsEventConsumer';
import { UtilisationAggregator }  from './UtilisationAggregator';
import { HeatmapBuilder }         from './HeatmapBuilder';
import { ReportExporter }         from './ReportExporter';
import { FreshnessGuard }         from './FreshnessGuard';
import type { FreshnessStatus }   from './FreshnessGuard';

export class AnalyticsService {
  private readonly repo:      AnalyticsRepository;
  private readonly consumer:  AnalyticsEventConsumer;
  private readonly heatmap:   HeatmapBuilder;
  private readonly exporter:  ReportExporter;
  private readonly freshness: FreshnessGuard;

  constructor(db: Pool) {
    this.repo     = new AnalyticsRepository(db);
    const agg     = new UtilisationAggregator(this.repo);
    this.consumer = new AnalyticsEventConsumer(this.repo, agg);
    this.heatmap  = new HeatmapBuilder(this.repo);
    this.exporter = new ReportExporter(this.repo);
    this.freshness = new FreshnessGuard(this.repo);
  }

  /** Ingest a booking lifecycle event (called by internal webhook). */
  async processEvent(event: AnalyticsEvent): Promise<void> {
    return this.consumer.consume(event);
  }

  /** Build a utilisation heatmap (Admin dashboard — FR-7). */
  async getHeatmap(params: {
    from:        string;
    to:          string;
    resourceId?: string;
    department?: string;
  }): Promise<HeatmapResult> {
    return this.heatmap.build(params);
  }

  /** Get summary counts per event type for a date range (FR-7). */
  async getSummary(params: { from: string; to: string; department?: string; resourceId?: string }): Promise<AnalyticsSummary> {
    return this.repo.getSummary(params);
  }

  /** Export raw analytics events as CSV (FR-7). */
  async exportCsv(params: {
    from:        string;
    to:          string;
    resourceId?: string;
    department?: string;
  }): Promise<string> {
    return this.exporter.exportCsv(params);
  }

  /**
   * NFR-1: Check whether the utilisation_snapshots materialised view is fresh.
   * Returns isFresh = true if the most recent snapshot was refreshed within 5 minutes.
   * Exposed so routes can include an X-Data-Freshness header in dashboard responses.
   */
  async getFreshnessStatus(): Promise<FreshnessStatus> {
    return this.freshness.check();
  }
}
