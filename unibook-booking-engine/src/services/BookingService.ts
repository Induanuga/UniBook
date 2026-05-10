// src/services/BookingService.ts
// Core booking transaction logic (FR-3, FR-4, ASR-1, ADR-001).
//
// Flow:
//   1. Policy check (Strategy pattern)
//   2. Open DB transaction
//   3. ConflictDetectionEngine.check() — SELECT FOR UPDATE
//   4. If clear → BookingRepository.insert()
//   5. If conflict → SlotSuggestionService.findNextAvailable()
//   6. Commit or rollback
//   7. Publish BookingSubmitted event (Observer pattern)
//
// BookingService has NO knowledge of:
//   - Which concrete IBookingPolicy runs (registry decides)
//   - Notification or Analytics subsystems (EventBus decouples them)
//   - HTTP layer (BookingFacade owns that)

import { Pool } from 'pg';
import axios from 'axios';
import type {
  BookingRequest,
  BookingResult,
  Booking,
  BookingEvent,
  JWTPayload,
} from '../types';
import { BookingRepository }      from '../repositories/BookingRepository';
import { ConflictDetectionEngine } from './ConflictDetectionEngine';
import { SlotSuggestionService }   from './SlotSuggestionService';
import { BookingPolicyRegistry }   from '../policies/BookingPolicyRegistry';
import { QuotaPolicy }             from '../policies/QuotaPolicy';
import { eventBus }                from '../events/EventBus';
import { logger }                  from '../utils/logger';
import { config }                  from '../config';

export class BookingService {
  private readonly bookingRepo:  BookingRepository;
  private readonly conflictEngine: ConflictDetectionEngine;
  private readonly slotService:  SlotSuggestionService;

  constructor(
    private readonly db:       Pool,
    private readonly registry: BookingPolicyRegistry,
  ) {
    this.bookingRepo    = new BookingRepository(db);
    this.conflictEngine = new ConflictDetectionEngine(db);
    this.slotService    = new SlotSuggestionService(db);
  }

  /**
   * Submit a new booking.
   * Returns BookingResult with the created booking, or conflict + suggestions.
   *
   * resourceType is fetched by BookingFacade from Resource Catalogue and passed in.
   */
  async submitBooking(
    request:      BookingRequest,
    user:         JWTPayload,
    resourceType: string,
    correlationId?: string,
  ): Promise<BookingResult> {
    const startTime = new Date(request.startTime);
    const endTime   = new Date(request.endTime);

    // ── 1. Policy validation (Strategy pattern) ──────────────────────────────
    const policy   = this.registry.getPolicyFor(resourceType);
    const decision = await policy.validate(request, user);

    if (!decision.allowed) {
      logger.info({
        correlationId,
        component:  'BookingService',
        action:     'POLICY_REJECTED',
        resourceType,
        reason:     decision.reason,
      });
      return {
        success: false,
        error:   decision.reason ?? 'Booking not permitted by resource policy.',
        code:    'POLICY_REJECTED',
      };
    }

    // ── 2. Open DB transaction ────────────────────────────────────────────────
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // ── 3. Conflict detection (SELECT FOR UPDATE) ─────────────────────────
      const conflict = await this.conflictEngine.check(
        request.resourceId,
        startTime,
        endTime,
        client,
        correlationId,
      );

      if (conflict.hasConflict) {
        await client.query('ROLLBACK');

        // ── 5. Slot suggestions ───────────────────────────────────────────────
        const suggestions = await this.slotService.findNextAvailable(
          request.resourceId,
          startTime,
          endTime,
          correlationId,
        );

        logger.info({
          correlationId,
          component:   'BookingService',
          action:      'CONFLICT_DETECTED',
          resourceId:  request.resourceId,
          suggestions: suggestions.length,
        });

        return {
          success:     false,
          error:       'The requested time slot is not available.',
          code:        'SLOT_CONFLICT',
          suggestions,
        };
      }

      // ── 4. Insert booking ─────────────────────────────────────────────────
      const booking = await this.bookingRepo.insert(
        {
          resourceId:     request.resourceId,
          userId:         user.sub,
          userEmail:      user.email,
          userRole:       user.role,
          department:     user.department,
          startTime,
          endTime,
          purpose:        request.purpose,
          attendeeCount:  request.attendeeCount,
          idempotencyKey: request.idempotencyKey,
        },
        client,
      );

      await client.query('COMMIT');

      // ── 6. Increment quota usage if applicable ────────────────────────────
      if (resourceType === 'GPU_CLUSTER') {
        const quotaPolicy = this.registry.getPolicyFor(resourceType) as QuotaPolicy;
        if (typeof quotaPolicy.incrementUsage === 'function') {
          await quotaPolicy.incrementUsage(user.department, startTime, endTime).catch((err) => {
            // Non-fatal — log and continue
            logger.error({
              correlationId,
              component: 'BookingService',
              action:    'QUOTA_INCREMENT_FAILED',
              error:     (err as Error).message,
            });
          });
        }
      }

      // ── 7. Publish event (Observer — after commit so event is never lost) ──
      const bookingEvent: BookingEvent = {
        eventType:     'BookingSubmitted',
        correlationId: correlationId ?? booking.id,
        bookingId:     booking.id,
        resourceId:    booking.resourceId,
        userId:        booking.userId,
        userEmail:     booking.userEmail,
        userName:      user.name,
        userRole:      booking.userRole,
        startTime:     booking.startTime.toISOString(),
        endTime:       booking.endTime.toISOString(),
        department:    booking.department,
        purpose:       booking.purpose,
        timestamp:     new Date().toISOString(),
      };

      eventBus.publish(bookingEvent);

      // ── 8. Notify Approval Workflow (Subsystem 4) asynchronously ─────────────
      setImmediate(() => {
        axios.post(
          `${config.services.approvalWorkflowUrl}/approvals/internal/booking-submitted`,
          bookingEvent,
          {
            headers: {
              'Content-Type':     'application/json',
              'X-Correlation-ID': correlationId ?? booking.id,
              'X-Service-Key':    config.jwt.secret,
            },
            timeout: 3000,
          },
        ).catch((err: Error) => {
          logger.warn({
            correlationId,
            component: 'BookingService',
            action:    'APPROVAL_WORKFLOW_NOTIFY_FAILED',
            bookingId: booking.id,
            error:     err.message,
          });
        });
      });

      // ── 9. Notify Analytics Service — BookingSubmitted event ─────────────────
      setImmediate(() => {
        axios.post(
          `${config.services.analyticsServiceUrl}/analytics/internal/event`,
          {
            eventType:     'BookingSubmitted',
            correlationId: correlationId ?? booking.id,
            bookingId:     booking.id,
            resourceId:    booking.resourceId,
            userId:        booking.userId,
            department:    booking.department,
            startTime:     booking.startTime.toISOString(),
            endTime:       booking.endTime.toISOString(),
            timestamp:     new Date().toISOString(),
          },
          {
            headers: { 'Content-Type': 'application/json', 'X-Service-Key': config.jwt.secret },
            timeout: 3000,
          },
        ).catch((err: Error) => {
          logger.warn({ correlationId, component: 'BookingService', action: 'ANALYTICS_SUBMITTED_NOTIFY_FAILED', bookingId: booking.id, error: err.message });
        });
      });

      logger.info({
        correlationId,
        component:  'BookingService',
        action:     'BOOKING_CREATED',
        bookingId:  booking.id,
        resourceId: booking.resourceId,
        userId:     booking.userId,
      });

      return { success: true, booking };
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({
        correlationId,
        component: 'BookingService',
        action:    'BOOKING_FAILED',
        error:     (err as Error).message,
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /** Cancel a booking. Publishes BookingCancelled event on success. */
  async cancelBooking(
    bookingId:        string,
    requestingUserId: string,
    requestingRole:   string,
    correlationId?:   string,
  ): Promise<Booking | null> {
    const booking = await this.bookingRepo.cancel(
      bookingId,
      requestingUserId,
      requestingRole,
    );

    if (booking) {
      const cancelEvent: BookingEvent = {
        eventType:     'BookingCancelled',
        correlationId: correlationId ?? bookingId,
        bookingId:     booking.id,
        resourceId:    booking.resourceId,
        userId:        booking.userId,
        userEmail:     booking.userEmail,
        startTime:     booking.startTime.toISOString(),
        endTime:       booking.endTime.toISOString(),
        department:    booking.department,
        timestamp:     new Date().toISOString(),
      };
      eventBus.publish(cancelEvent);

      logger.info({
        correlationId,
        component: 'BookingService',
        action:    'BOOKING_CANCELLED',
        bookingId,
      });

      // Notify Analytics Service (Subsystem 6) — fire-and-forget
      setImmediate(() => {
        axios.post(
          `${config.services.analyticsServiceUrl}/analytics/internal/event`,
          {
            eventType:     'BookingCancelled',
            correlationId: correlationId ?? bookingId,
            bookingId:     booking.id,
            resourceId:    booking.resourceId,
            userId:        booking.userId,
            department:    booking.department,
            startTime:     booking.startTime.toISOString(),
            endTime:       booking.endTime.toISOString(),
            timestamp:     new Date().toISOString(),
          },
          {
            headers: { 'Content-Type': 'application/json', 'X-Service-Key': config.jwt.secret },
            timeout: 3000,
          },
        ).catch((err: Error) => {
          logger.warn({ correlationId, component: 'BookingService', action: 'ANALYTICS_NOTIFY_FAILED', bookingId, error: err.message });
        });
      });

      // Notify Approval Workflow (Subsystem 4) of cancellation — fire-and-forget
      setImmediate(() => {
        axios.post(
          `${config.services.approvalWorkflowUrl}/approvals/internal/booking-cancelled`,
          {
            eventType:     'BookingCancelled',
            correlationId: correlationId ?? bookingId,
            bookingId:     booking.id,
            resourceId:    booking.resourceId,
            userId:        booking.userId,
            userEmail:     booking.userEmail,
            startTime:     booking.startTime.toISOString(),
            endTime:       booking.endTime.toISOString(),
            department:    booking.department,
            timestamp:     new Date().toISOString(),
          },
          {
            headers: { 'Content-Type': 'application/json', 'X-Service-Key': config.jwt.secret },
            timeout: 3000,
          },
        ).catch((err: Error) => {
          logger.warn({ correlationId, component: 'BookingService', action: 'APPROVAL_NOTIFY_FAILED', bookingId, error: err.message });
        });
      });
    }

    return booking;
  }

  /** Get a single booking by ID. */
  async getBooking(id: string): Promise<Booking | null> {
    return this.bookingRepo.findById(id);
  }

  /** Alias for getBooking — used by BookingFacade.updateBookingStatus */
  async getBookingById(id: string): Promise<Booking | null> {
    return this.bookingRepo.findById(id);
  }

  /** Get all bookings for the requesting user. */
  async getMyBookings(userId: string): Promise<Booking[]> {
    return this.bookingRepo.findByUserId(userId);
  }

  /**
   * Update booking status — called by Approval Workflow (Subsystem 4).
   * Uses optimistic locking via expectedVersion.
   * Publishes BookingApproved or BookingRejected event.
   */
  async updateStatus(
    bookingId:       string,
    newStatus:       'APPROVED' | 'REJECTED',
    expectedVersion: number,
    correlationId?:  string,
  ): Promise<Booking | null> {
    const updated = await this.bookingRepo.updateStatusFromApproval(
      bookingId,
      newStatus,
      expectedVersion,
    );

    if (updated) {
      const eventType: 'BookingApproved' | 'BookingRejected' = newStatus === 'APPROVED' ? 'BookingApproved' : 'BookingRejected';
      const approvalEvent: BookingEvent = {
        eventType,
        correlationId: correlationId ?? bookingId,
        bookingId:     updated.id,
        resourceId:    updated.resourceId,
        userId:        updated.userId,
        userEmail:     updated.userEmail,
        startTime:     updated.startTime.toISOString(),
        endTime:       updated.endTime.toISOString(),
        department:    updated.department,
        timestamp:     new Date().toISOString(),
      };
      eventBus.publish(approvalEvent);

      logger.info({
        correlationId,
        component:  'BookingService',
        action:     `BOOKING_${newStatus}`,
        bookingId,
        newStatus,
      });
    }

    return updated;
  }
}
