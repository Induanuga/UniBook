// src/cache/AvailabilityCacheManager.ts
// Tactic 2 — Read-Through Cache with Redis (ADR-002).
//
// Design:
//   • READ:  On cache miss → fetch from PostgreSQL → write to Redis with 30s TTL.
//   • WRITE: On booking change (submitted / cancelled / approved / rejected) →
//            invalidate the affected resource+date keys immediately (write-invalidate).
//
// NFR-1 target: >= 90% cache hit rate at peak; P95 cached-read latency ~20ms.
// NFR-5 target: Redis shields PostgreSQL during 10x traffic spikes at registration.
//
// Pattern: This class is the Proxy pattern — it wraps the real PostgreSQL data
// source and transparently intercepts read calls to serve from cache when possible.
// It also acts as the Subject in the Observer pattern: booking events from the
// Booking Engine trigger invalidation via BookingEventListener.

import type { Redis } from 'ioredis';
import type { AvailabilityCalendar, TimeSlot, BookingRecord } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

const CACHE_VERSION = 'v1'; // bump to mass-invalidate all keys on schema change

export class AvailabilityCacheManager {
  constructor(private readonly redis: Redis) {}

  // ── Key helpers ────────────────────────────────────────────────────────────

  /**
   * Canonical cache key for availability of a resource on a date.
   * Pattern: avail:{version}:{resourceId}:{YYYY-MM-DD}
   */
  availabilityKey(resourceId: string, date: string): string {
    return `avail:${CACHE_VERSION}:${resourceId}:${date}`;
  }

  /**
   * Cache key for a single resource's metadata.
   * Used to serve GET /resources/:id without a DB round-trip.
   */
  resourceKey(resourceId: string): string {
    return `resource:${CACHE_VERSION}:${resourceId}`;
  }

  /**
   * Pattern key for all availability slots of a resource (for bulk invalidation).
   * Redis SCAN-based deletion — never use KEYS in production.
   */
  resourceAvailabilityPattern(resourceId: string): string {
    return `avail:${CACHE_VERSION}:${resourceId}:*`;
  }

  // ── Read operations ────────────────────────────────────────────────────────

  /**
   * Get availability slots from cache for a resource+date.
   * Returns null on miss (caller must fetch from DB and then call set()).
   */
  async getAvailability(
    resourceId: string,
    date: string,
    correlationId?: string,
  ): Promise<AvailabilityCalendar | null> {
    const key = this.availabilityKey(resourceId, date);

    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        logger.debug({ correlationId, component: 'AvailabilityCacheManager', action: 'CACHE_MISS', key });
        return null;
      }

      logger.debug({ correlationId, component: 'AvailabilityCacheManager', action: 'CACHE_HIT', key });
      const data = JSON.parse(raw) as AvailabilityCalendar;
      data.fromCache = true;
      return data;
    } catch (err) {
      logger.warn({
        correlationId,
        component: 'AvailabilityCacheManager',
        action:    'CACHE_GET_ERROR',
        key,
        error:     (err as Error).message,
      });
      return null; // degrade gracefully — caller will hit DB
    }
  }

  /**
   * Get cached resource metadata.
   * Returns null on miss.
   */
  async getResource(
    resourceId: string,
    correlationId?: string,
  ): Promise<Record<string, unknown> | null> {
    const key = this.resourceKey(resourceId);

    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      logger.debug({ correlationId, component: 'AvailabilityCacheManager', action: 'RESOURCE_CACHE_HIT', key });
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // ── Write operations ───────────────────────────────────────────────────────

  /**
   * Store availability data in Redis with the configured TTL.
   * Called by AvailabilityCalendarService after a DB read (read-through).
   */
  async setAvailability(
    resourceId: string,
    date: string,
    calendar: AvailabilityCalendar,
    correlationId?: string,
  ): Promise<void> {
    const key = this.availabilityKey(resourceId, date);
    const ttl = config.redis.availabilityTtlSeconds;

    try {
      await this.redis.set(key, JSON.stringify(calendar), 'EX', ttl);
      logger.debug({
        correlationId,
        component: 'AvailabilityCacheManager',
        action:    'CACHE_SET',
        key,
        ttl,
        slotCount: calendar.slots.length,
      });
    } catch (err) {
      // Non-fatal — next request will just miss and re-populate
      logger.warn({
        correlationId,
        component: 'AvailabilityCacheManager',
        action:    'CACHE_SET_ERROR',
        key,
        error:     (err as Error).message,
      });
    }
  }

  /**
   * Store resource metadata with the longer resource TTL.
   */
  async setResource(
    resourceId: string,
    resource: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const key = this.resourceKey(resourceId);
    const ttl = config.redis.resourceTtlSeconds;

    try {
      await this.redis.set(key, JSON.stringify(resource), 'EX', ttl);
      logger.debug({ correlationId, component: 'AvailabilityCacheManager', action: 'RESOURCE_CACHE_SET', key, ttl });
    } catch (err) {
      logger.warn({ correlationId, component: 'AvailabilityCacheManager', action: 'RESOURCE_CACHE_SET_ERROR', error: (err as Error).message });
    }
  }

  // ── Invalidation operations ────────────────────────────────────────────────

  /**
   * Invalidate ALL availability cache entries for a resource.
   * Called immediately when a booking for that resource changes state
   * (BookingSubmitted, BookingApproved, BookingRejected, BookingCancelled).
   *
   * Uses Redis SCAN + DEL (not KEYS) to avoid blocking the event loop.
   * Adds ~5ms to booking confirmation writes (ADR-002 trade-off, acceptable).
   */
  async invalidateResource(
    resourceId: string,
    correlationId?: string,
  ): Promise<void> {
    const pattern = this.resourceAvailabilityPattern(resourceId);
    let cursor = '0';
    let deleted = 0;

    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH', pattern,
          'COUNT', 100,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      logger.info({
        correlationId,
        component:  'AvailabilityCacheManager',
        action:     'CACHE_INVALIDATED',
        resourceId,
        keysDeleted: deleted,
      });
    } catch (err) {
      // Non-fatal — stale data will expire naturally at TTL boundary
      logger.warn({
        correlationId,
        component: 'AvailabilityCacheManager',
        action:    'CACHE_INVALIDATION_ERROR',
        resourceId,
        error:     (err as Error).message,
      });
    }
  }

  /**
   * Invalidate availability for a specific resource+date range.
   * More targeted than invalidateResource — used when maintenance windows change.
   */
  async invalidateDateRange(
    resourceId: string,
    startDate: string,
    endDate: string,
    correlationId?: string,
  ): Promise<void> {
    const start = new Date(startDate);
    const end   = new Date(endDate);
    const keys: string[] = [];

    // Build list of affected YYYY-MM-DD keys
    const cursor = new Date(start);
    while (cursor <= end) {
      keys.push(this.availabilityKey(resourceId, cursor.toISOString().slice(0, 10)));
      cursor.setDate(cursor.getDate() + 1);
    }

    try {
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info({
          correlationId,
          component:  'AvailabilityCacheManager',
          action:     'CACHE_INVALIDATED_DATE_RANGE',
          resourceId,
          keysDeleted: keys.length,
        });
      }
    } catch (err) {
      logger.warn({
        correlationId,
        component: 'AvailabilityCacheManager',
        action:    'CACHE_INVALIDATION_DATE_RANGE_ERROR',
        error:     (err as Error).message,
      });
    }
  }

  /**
   * Invalidate resource metadata cache (called when admin updates a resource).
   */
  async invalidateResourceMeta(resourceId: string, correlationId?: string): Promise<void> {
    try {
      await this.redis.del(this.resourceKey(resourceId));
      logger.info({ correlationId, component: 'AvailabilityCacheManager', action: 'RESOURCE_META_INVALIDATED', resourceId });
    } catch (err) {
      logger.warn({ correlationId, component: 'AvailabilityCacheManager', action: 'RESOURCE_META_INVALIDATION_ERROR', error: (err as Error).message });
    }
  }

  /**
   * Compute availability metrics for the health endpoint.
   * Reports approximate cache size — for monitoring NFR-1 cache hit targets.
   */
  async getCacheStats(): Promise<{ availabilityKeys: number; resourceKeys: number }> {
    try {
      let availabilityKeys = 0;
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `avail:${CACHE_VERSION}:*`, 'COUNT', 100);
        cursor = next;
        availabilityKeys += keys.length;
      } while (cursor !== '0');

      let resourceKeys = 0;
      cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `resource:${CACHE_VERSION}:*`, 'COUNT', 100);
        cursor = next;
        resourceKeys += keys.length;
      } while (cursor !== '0');

      return { availabilityKeys, resourceKeys };
    } catch {
      return { availabilityKeys: -1, resourceKeys: -1 };
    }
  }

  /**
   * Build an array of AvailabilityCalendar slot objects from raw booking records.
   * Static helper — used by AvailabilityCalendarService to pre-compute before caching.
   * 15-minute granularity (FR-1): 96 slots per day.
   */
  static buildSlots(
    date: string,
    bookings: BookingRecord[],
    maintenanceWindows: Array<{ startTime: Date; endTime: Date }>,
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const dayStart = new Date(`${date}T00:00:00.000Z`);

    for (let i = 0; i < 96; i++) {
      const slotStart = new Date(dayStart.getTime() + i * 15 * 60 * 1000);
      const slotEnd   = new Date(slotStart.getTime() + 15 * 60 * 1000);

      const isApproved = bookings.some(
        (b) =>
          b.status === 'APPROVED' &&
          b.startTime < slotEnd &&
          b.endTime   > slotStart,
      );

      const isPending = bookings.some(
        (b) =>
          b.status === 'PENDING' &&
          b.startTime < slotEnd &&
          b.endTime   > slotStart,
      );

      const inMaintenance = maintenanceWindows.some(
        (m) => m.startTime < slotEnd && m.endTime > slotStart,
      );

      let status: TimeSlot['status'] = 'FREE';
      if (inMaintenance) status = 'MAINTENANCE';
      else if (isApproved)  status = 'BOOKED';
      else if (isPending) status = 'PENDING';

      slots.push({
        startTime: slotStart.toISOString(),
        endTime:   slotEnd.toISOString(),
        status,
      });
    }

    return slots;
  }
}
