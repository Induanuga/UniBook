// src/services/AvailabilityCalendarService.ts
// Implements the read-through cache strategy described in Tactic 2 (ADR-002).
//
// Responsibility: answer "when is this resource free?" using a two-layer approach:
//   Layer 1 — Redis cache (target: >= 90% hit rate at peak, ~20ms response)
//   Layer 2 — PostgreSQL (fallback; populates cache after read)
//
// Slot granularity: 15 minutes per FR-1 ("live calendar at 15-minute granularity").
// Cache staleness: at most 30 seconds (ADR-002 trade-off, acceptable for booking UX).
//
// Patterns used:
//   • Template Method — getAvailability() defines the skeleton (check cache → load DB
//     → build slots → populate cache) and _loadFromDb() is the variant step.
//   • Proxy — AvailabilityCacheManager transparently intercepts reads, serving from
//     Redis when possible and delegating to this service on miss.

import type { AvailabilityCalendar, BookingRecord } from '../types';
import type { ResourceRepository } from '../repositories/ResourceRepository';
import  { AvailabilityCacheManager } from '../cache/AvailabilityCacheManager';
import { logger } from '../utils/logger';

export class AvailabilityCalendarService {
  constructor(
    private readonly resourceRepo:  ResourceRepository,
    private readonly cacheManager:  AvailabilityCacheManager,
  ) {}

  /**
   * Template Method — fixed algorithm skeleton:
   *   1. Try cache.
   *   2. On miss, load from DB.
   *   3. Build 15-min slots.
   *   4. Populate cache.
   *   5. Return calendar.
   *
   * @param resourceId  The resource UUID.
   * @param date        YYYY-MM-DD date string.
   */
  async getAvailability(
    resourceId:     string,
    date:           string,
    correlationId?: string,
  ): Promise<AvailabilityCalendar> {
    // ── Step 1: Cache check ────────────────────────────────────────────────
    const cached = await this.cacheManager.getAvailability(resourceId, date, correlationId);
    if (cached) {
      return cached;
    }

    // ── Step 2: DB load (variant step) ────────────────────────────────────
    const { bookings, maintenanceWindows, resourceName } =
      await this._loadFromDb(resourceId, date, correlationId);

    // ── Step 3: Build 15-min slots ─────────────────────────────────────────
    const slots = AvailabilityCacheManager.buildSlots(date, bookings, maintenanceWindows);

    // ── Step 4: Build calendar object ─────────────────────────────────────
    const calendar: AvailabilityCalendar = {
      resourceId,
      resourceName,
      date,
      slots,
      cachedAt:  new Date().toISOString(),
      fromCache: false,
    };

    // ── Step 5: Populate cache (fire-and-forget — non-blocking) ───────────
    void this.cacheManager.setAvailability(resourceId, date, calendar, correlationId);

    logger.info({
      correlationId,
      component:   'AvailabilityCalendarService',
      action:      'AVAILABILITY_COMPUTED_FROM_DB',
      resourceId,
      date,
      freeSlots:   slots.filter((s) => s.status === 'FREE').length,
      totalSlots:  slots.length,
    });

    return calendar;
  }

  /**
   * Variant step (Template Method) — loads raw data from PostgreSQL.
   * Isolated here so it can be individually unit-tested and swapped
   * without changing the caching skeleton.
   */
  private async _loadFromDb(
    resourceId:     string,
    date:           string,
    correlationId?: string,
  ): Promise<{
    bookings:           BookingRecord[];
    maintenanceWindows: Array<{ startTime: Date; endTime: Date }>;
    resourceName:       string;
  }> {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd   = new Date(`${date}T23:59:59.999Z`);

    const [resource, bookings, maintenanceWindows] = await Promise.all([
      this.resourceRepo.findById(resourceId, correlationId),
      this.resourceRepo.findBookingsForResource(resourceId, dayStart, dayEnd),
      this.resourceRepo.findMaintenanceWindows(resourceId, dayStart, dayEnd),
    ]);

    const resourceName = resource?.name ?? resourceId;

    logger.debug({
      correlationId,
      component:          'AvailabilityCalendarService',
      action:             'DB_LOAD',
      resourceId,
      date,
      bookingCount:       bookings.length,
      maintenanceCount:   maintenanceWindows.length,
    });

    return { bookings, maintenanceWindows, resourceName };
  }
}
