// src/events/BookingEventListener.ts
// Observer pattern — subscribes to booking lifecycle events published by Subsystem 3
// (Booking Engine) and triggers immediate cache invalidation on the affected resource.
//
// This is the ONLY place where Subsystem 2 couples to the Booking Engine — and
// it does so asynchronously via an HTTP webhook endpoint (/internal/booking-events),
// not a direct import. This preserves the subsystem coupling rule:
//   "No subsystem imports another subsystem's internal module."
//
// When the Booking Engine publishes BookingSubmitted / BookingApproved /
// BookingRejected / BookingCancelled, it HTTP-POSTs the event to this endpoint.
// The listener calls AvailabilityCacheManager.invalidateResource(), ensuring that
// the next availability read reflects the new booking state within milliseconds —
// far below the 30-second TTL that would otherwise introduce staleness.
//
// NFR-4 reliability: cache invalidation errors are logged but never propagate
// back to the caller — availability will naturally expire at the 30s TTL boundary.

import { Router, Request, Response } from 'express';
import type { BookingEventPayload } from '../types';
import type { AvailabilityCacheManager } from '../cache/AvailabilityCacheManager';
import { logger } from '../utils/logger';

/**
 * Creates an Express router for the internal booking event webhook.
 * Mounted at /internal/booking-events (not exposed externally via public CORS).
 */
export function createBookingEventRouter(
  cacheManager: AvailabilityCacheManager,
): Router {
  const router = Router();

  /**
   * POST /internal/booking-events
   *
   * Receives booking lifecycle events from the Booking Engine.
   * Immediately invalidates the availability cache for the affected resource.
   *
   * Security: This route is intended for inter-service communication only.
   * In production, protect with a shared secret header or mTLS.
   * For the prototype, it is mounted separately and can be firewalled.
   */
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    const correlationId = req.correlationId;

    const event = req.body as Partial<BookingEventPayload>;

    if (!event.resourceId || !event.eventType) {
      res.status(400).json({ error: 'Missing resourceId or eventType', code: 'INVALID_EVENT' });
      return;
    }

    logger.info({
      correlationId,
      component:  'BookingEventListener',
      action:     'EVENT_RECEIVED',
      eventType:  event.eventType,
      resourceId: event.resourceId,
      bookingId:  event.bookingId,
    });

    // Fire-and-forget: respond 200 immediately, invalidate asynchronously.
    // This ensures the Booking Engine's own response time is never blocked by
    // cache invalidation latency (ADR-004 principle applied to Subsystem 2).
    res.status(200).json({ acknowledged: true });

    // Invalidate availability cache for this resource immediately.
    // All dates for the resource are invalidated so stale data cannot persist
    // regardless of which date the booking falls on.
    void (async () => {
      try {
        await cacheManager.invalidateResource(event.resourceId!, correlationId);

        logger.info({
          correlationId,
          component:  'BookingEventListener',
          action:     'CACHE_INVALIDATED',
          eventType:  event.eventType,
          resourceId: event.resourceId,
        });
      } catch (err) {
        // Non-fatal — stale data expires at 30s TTL (ADR-002 trade-off)
        logger.warn({
          correlationId,
          component:  'BookingEventListener',
          action:     'INVALIDATION_ERROR',
          resourceId: event.resourceId,
          error:      (err as Error).message,
        });
      }
    })();
  });

  return router;
}
