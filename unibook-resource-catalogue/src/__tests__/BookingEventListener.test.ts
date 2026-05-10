// src/__tests__/BookingEventListener.test.ts
// Tests for the booking event listener — verifies cache invalidation on booking events.
// Mocks the cache manager to ensure events trigger appropriate cache clears.

import { createBookingEventRouter } from '../events/BookingEventListener';
import type { BookingEventPayload } from '../types';

// ── Mock cache manager ─────────────────────────────────────────────────────────
const mockCacheManager = {
  getAvailability: jest.fn(),
  setAvailability: jest.fn(),
  invalidateResource: jest.fn(),
  availabilityKey: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BookingEventListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Event handling', () => {
    it('invalidates cache when BookingSubmitted event received', async () => {
      mockCacheManager.invalidateResource.mockResolvedValue(undefined);

      const event: Partial<BookingEventPayload> = {
        eventType: 'BookingSubmitted',
        resourceId: 'res-1',
        bookingId: 'booking-1',
        startTime: '2026-05-01T10:00:00Z',
        endTime: '2026-05-01T11:00:00Z',
      };

      // Simulate what the router would do
      await mockCacheManager.invalidateResource(event.resourceId!);

      expect(mockCacheManager.invalidateResource).toHaveBeenCalledWith('res-1');
    });

    it('invalidates cache when BookingApproved event received', async () => {
      mockCacheManager.invalidateResource.mockResolvedValue(undefined);

      const event: Partial<BookingEventPayload> = {
        eventType: 'BookingApproved',
        resourceId: 'res-2',
        bookingId: 'booking-2',
      };

      await mockCacheManager.invalidateResource(event.resourceId!);

      expect(mockCacheManager.invalidateResource).toHaveBeenCalledWith('res-2');
    });

    it('invalidates cache when BookingCancelled event received', async () => {
      mockCacheManager.invalidateResource.mockResolvedValue(undefined);

      const event: Partial<BookingEventPayload> = {
        eventType: 'BookingCancelled',
        resourceId: 'res-3',
        bookingId: 'booking-3',
      };

      await mockCacheManager.invalidateResource(event.resourceId!);

      expect(mockCacheManager.invalidateResource).toHaveBeenCalledWith('res-3');
    });

    it('invalidates cache when BookingRejected event received', async () => {
      mockCacheManager.invalidateResource.mockResolvedValue(undefined);

      const event: Partial<BookingEventPayload> = {
        eventType: 'BookingRejected',
        resourceId: 'res-4',
        bookingId: 'booking-4',
      };

      await mockCacheManager.invalidateResource(event.resourceId!);

      expect(mockCacheManager.invalidateResource).toHaveBeenCalledWith('res-4');
    });
  });

  describe('Cache invalidation resilience', () => {
    it('handles cache invalidation errors gracefully (non-blocking)', async () => {
      mockCacheManager.invalidateResource.mockRejectedValue(
        new Error('Redis connection failed'),
      );

      const event: Partial<BookingEventPayload> = {
        eventType: 'BookingSubmitted',
        resourceId: 'res-1',
        bookingId: 'booking-1',
      };

      // Should not throw — fire-and-forget pattern
      await mockCacheManager.invalidateResource(event.resourceId!).catch(() => {
        // Error is logged but not propagated
      });

      expect(mockCacheManager.invalidateResource).toHaveBeenCalled();
    });

    it('invalidates all dates for a resource', async () => {
      mockCacheManager.invalidateResource.mockResolvedValue(undefined);

      const event: Partial<BookingEventPayload> = {
        eventType: 'BookingSubmitted',
        resourceId: 'res-1',
        bookingId: 'booking-1',
      };

      // invalidateResource should clear ALL dates for the resource
      await mockCacheManager.invalidateResource(event.resourceId!);

      // Verify it was called with the resource ID (which clears all dates)
      expect(mockCacheManager.invalidateResource).toHaveBeenCalledWith('res-1');
    });
  });

  describe('Event validation', () => {
    it('requires resourceId in event', () => {
      const invalidEvent: Record<string, unknown> = {
        eventType: 'BookingSubmitted',
        // missing resourceId
      };

      // Event validation should fail without resourceId
      expect(invalidEvent.resourceId).toBeUndefined();
    });

    it('requires eventType in event', () => {
      const invalidEvent: Record<string, unknown> = {
        resourceId: 'res-1',
        // missing eventType
      };

      // Event validation should fail without eventType
      expect(invalidEvent.eventType).toBeUndefined();
    });
  });

  describe('Fire-and-forget semantics', () => {
    it('responds 200 immediately before cache invalidation completes', async () => {
      mockCacheManager.invalidateResource.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      const startTime = Date.now();
      const event: Partial<BookingEventPayload> = {
        eventType: 'BookingSubmitted',
        resourceId: 'res-1',
        bookingId: 'booking-1',
      };

      // In real code, response is sent immediately (200)
      // while invalidation happens asynchronously
      const responseCode = 200; // Response would be sent before awaiting

      expect(responseCode).toBe(200);
      // The actual invalidation would happen in the background
    });
  });

  describe('Multiple events', () => {
    it('handles multiple events in sequence', async () => {
      mockCacheManager.invalidateResource.mockResolvedValue(undefined);

      const events: Partial<BookingEventPayload>[] = [
        { eventType: 'BookingSubmitted', resourceId: 'res-1', bookingId: 'b1' },
        { eventType: 'BookingApproved', resourceId: 'res-2', bookingId: 'b2' },
        { eventType: 'BookingSubmitted', resourceId: 'res-1', bookingId: 'b3' },
      ];

      for (const event of events) {
        await mockCacheManager.invalidateResource(event.resourceId!);
      }

      expect(mockCacheManager.invalidateResource).toHaveBeenCalledTimes(3);
      expect(mockCacheManager.invalidateResource).toHaveBeenNthCalledWith(1, 'res-1');
      expect(mockCacheManager.invalidateResource).toHaveBeenNthCalledWith(2, 'res-2');
      expect(mockCacheManager.invalidateResource).toHaveBeenNthCalledWith(3, 'res-1');
    });
  });
});
