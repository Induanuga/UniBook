// src/services/AnalyticsEventConsumer.ts
// Observer pattern — subscribes to booking lifecycle events pushed via the
// internal webhook endpoint (POST /analytics/internal/event).
//
// Responsibilities:
//   1. Persist the raw event to analytics_events (append-only log).
//   2. Delegate snapshot upsert to UtilisationAggregator for approved/cancelled events.
//
// Zero synchronous dependency on the Booking Engine (ADR-004).
// Reads from its own materialised views only — never touches booking tables (NFR-1).

import type { AnalyticsEvent } from '../types';
import type { AnalyticsRepository } from '../repositories/AnalyticsRepository';
import type { UtilisationAggregator } from './UtilisationAggregator';
import { logger } from '../utils/logger';

export class AnalyticsEventConsumer {
  constructor(
    private readonly repo:        AnalyticsRepository,
    private readonly aggregator:  UtilisationAggregator,
  ) {}

  /**
   * Process an incoming analytics event.
   * Called by the internal webhook handler after basic validation.
   */
  async consume(event: AnalyticsEvent): Promise<void> {
    // 1. Persist raw event (all 4 types are now tracked)
    await this.repo.insertEvent(event);

    // 2. Update utilisation snapshot for approved / cancelled events
    if (event.eventType === 'BookingApproved') {
      await this.aggregator.increment(
        event.resourceId,
        event.department,
        new Date(event.startTime),
        new Date(event.endTime),
      );
    } else if (event.eventType === 'BookingCancelled') {
      await this.aggregator.decrement(
        event.resourceId,
        event.department,
        new Date(event.startTime),
        new Date(event.endTime),
      );
    }

    logger.info({
      correlationId: event.correlationId,
      component:     'AnalyticsEventConsumer',
      action:        'CONSUMED',
      eventType:     event.eventType,
      bookingId:     event.bookingId,
    });
  }
}
