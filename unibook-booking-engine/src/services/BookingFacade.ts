// src/services/BookingFacade.ts
// Facade pattern — provides the single entry point for the Booking Engine subsystem.
// Orchestrates: IdempotencyGuard → BookingService → IdempotencyGuard.record()
//
// The API contract (POST /bookings) remains stable regardless of changes to the
// internal orchestration sequence. Only BookingFacade changes if the flow changes.
//
// Also fetches resource type from the Resource Catalogue (HTTP call) so
// BookingService can apply the correct IBookingPolicy.

import axios from 'axios';
import type { BookingRequest, BookingResult, Booking, JWTPayload } from '../types';
import { BookingService }    from './BookingService';
import { IdempotencyGuard }  from './IdempotencyGuard';
import { config }            from '../config';
import { logger }            from '../utils/logger';

export class BookingFacade {
  constructor(
    private readonly bookingService:   BookingService,
    private readonly idempotencyGuard: IdempotencyGuard,
  ) {}

  /**
   * Submit a booking.
   * This is the ONLY public entry point for creating a booking.
   */
  async submitBooking(
    request:       BookingRequest,
    user:          JWTPayload,
    correlationId?: string,
  ): Promise<{ statusCode: number; body: BookingResult }> {

    // ── 1. Idempotency check ──────────────────────────────────────────────────
    const cached = await this.idempotencyGuard.check(
      request.idempotencyKey,
      correlationId,
    );
    if (cached) {
      return { statusCode: cached.statusCode, body: cached.body as unknown as BookingResult };
    }

    // ── 2. Fetch resource details (type, capacity) for policy selection ──────
    const resourceData = await this.fetchResource(
      request.resourceId,
      correlationId,
    );
    const resourceType = resourceData.resourceType ?? 'SEMINAR_ROOM';

    // ── 2b. Validate attendee count against capacity ─────────────────────────
    if (resourceData.capacity && request.attendeeCount > resourceData.capacity) {
      const result: BookingResult = {
        success: false,
        error:   `Resource capacity is ${resourceData.capacity} but you requested ${request.attendeeCount} attendees.`,
        code:    'CAPACITY_EXCEEDED',
      };
      return { statusCode: 422, body: result };
    }

    // ── 3. Execute booking ────────────────────────────────────────────────────
    const result = await this.bookingService.submitBooking(
      request,
      user,
      resourceType,
      correlationId,
    );

    const statusCode = result.success ? 201 : (result.code === 'SLOT_CONFLICT' ? 409 : 422);

    // ── 4. Record idempotency key (only on success so failed requests can retry) ──
    if (result.success && result.booking) {
      await this.idempotencyGuard.record(
        request.idempotencyKey,
        result.booking.id,
        statusCode,
        result as unknown as Record<string, unknown>,
        correlationId,
      );
    }

    return { statusCode, body: result };
  }

  async cancelBooking(
    bookingId:        string,
    requestingUserId: string,
    requestingRole:   string,
    correlationId?:   string,
  ): Promise<Booking | null> {
    return this.bookingService.cancelBooking(
      bookingId,
      requestingUserId,
      requestingRole,
      correlationId,
    );
  }

  async getBooking(id: string): Promise<Booking | null> {
    return this.bookingService.getBooking(id);
  }

  async getMyBookings(userId: string): Promise<Booking[]> {
    return this.bookingService.getMyBookings(userId);
  }

  /**
   * Update booking status — called internally by Approval Workflow (Subsystem 4).
   * Only APPROVED and REJECTED statuses are allowed via this path.
   */
  async updateBookingStatus(
    bookingId:      string,
    newStatus:      'APPROVED' | 'REJECTED',
    correlationId?: string,
  ): Promise<Booking | null> {
    const booking = await this.bookingService.getBookingById(bookingId);
    if (!booking) return null;

    const updated = await this.bookingService.updateStatus(
      bookingId,
      newStatus,
      booking.version,
      correlationId,
    );

    return updated;
  }

  /**
   * Fetch resource details from the Resource Catalogue subsystem.
   * Retrieves type and capacity for policy selection and validation.
   * Falls back to defaults if the catalogue is unreachable,
   * so the Booking Engine degrades gracefully rather than hard-failing.
   */
  private async fetchResource(
    resourceId:     string,
    correlationId?: string,
  ): Promise<{ resourceType: string; capacity?: number }> {
    try {
      const response = await axios.get<{ typeId: string; capacity: number }>(
        `${config.services.resourceCatalogueUrl}/resources/${resourceId}`,
        {
          headers: { 'X-Correlation-ID': correlationId ?? '' },
          timeout: 2000,
        },
      );
      return {
        resourceType: response.data.typeId ?? 'SEMINAR_ROOM',
        capacity:     response.data.capacity,
      };
    } catch (err) {
      logger.warn({
        correlationId,
        component:  'BookingFacade',
        action:     'RESOURCE_CATALOGUE_UNREACHABLE',
        resourceId,
        error:      (err as Error).message,
        fallback:   'SEMINAR_ROOM (capacity check skipped)',
      });
      return { resourceType: 'SEMINAR_ROOM' };
    }
  }
}
