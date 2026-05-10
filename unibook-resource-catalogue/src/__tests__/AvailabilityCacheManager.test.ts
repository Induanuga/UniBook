// src/__tests__/AvailabilityCacheManager.test.ts
// Unit tests for the cache manager — verifies read-through and invalidation logic.
// All Redis calls are mocked so tests run without a real Redis instance.

import { AvailabilityCacheManager } from '../cache/AvailabilityCacheManager';
import type { AvailabilityCalendar, BookingRecord } from '../types';

// ── Mock Redis client ─────────────────────────────────────────────────────────
const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  scan: jest.fn(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeCalendar(resourceId: string, date: string): AvailabilityCalendar {
  return {
    resourceId,
    resourceName: 'Test Room',
    date,
    slots: [],
    cachedAt:  new Date().toISOString(),
    fromCache: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AvailabilityCacheManager', () => {
  let cacheManager: AvailabilityCacheManager;

  beforeEach(() => {
    jest.clearAllMocks();
    cacheManager = new AvailabilityCacheManager(mockRedis as never);
  });

  // ── Key helpers ─────────────────────────────────────────────────────────────

  describe('availabilityKey()', () => {
    it('produces a stable, versioned key', () => {
      const key = cacheManager.availabilityKey('res-1', '2026-05-01');
      expect(key).toBe('avail:v1:res-1:2026-05-01');
    });
  });

  // ── getAvailability ─────────────────────────────────────────────────────────

  describe('getAvailability()', () => {
    it('returns null on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await cacheManager.getAvailability('res-1', '2026-05-01');
      expect(result).toBeNull();
    });

    it('parses and returns cached calendar with fromCache=true', async () => {
      const calendar = makeCalendar('res-1', '2026-05-01');
      mockRedis.get.mockResolvedValue(JSON.stringify(calendar));

      const result = await cacheManager.getAvailability('res-1', '2026-05-01');
      expect(result).not.toBeNull();
      expect(result!.fromCache).toBe(true);
      expect(result!.resourceId).toBe('res-1');
    });

    it('returns null (degrades gracefully) when Redis throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('connection refused'));
      const result = await cacheManager.getAvailability('res-1', '2026-05-01');
      expect(result).toBeNull(); // must not propagate error
    });
  });

  // ── setAvailability ─────────────────────────────────────────────────────────

  describe('setAvailability()', () => {
    it('calls redis.set with the correct key and TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const calendar = makeCalendar('res-1', '2026-05-01');

      await cacheManager.setAvailability('res-1', '2026-05-01', calendar);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'avail:v1:res-1:2026-05-01',
        expect.any(String),
        'EX',
        30, // default TTL
      );
    });

    it('does not throw when Redis set fails', async () => {
      mockRedis.set.mockRejectedValue(new Error('READONLY'));
      const calendar = makeCalendar('res-1', '2026-05-01');
      await expect(cacheManager.setAvailability('res-1', '2026-05-01', calendar)).resolves.not.toThrow();
    });
  });

  // ── invalidateResource ──────────────────────────────────────────────────────

  describe('invalidateResource()', () => {
    it('scans and deletes all keys for a resource', async () => {
      // Simulate two scan pages: first returns keys, second signals end (cursor '0')
      mockRedis.scan
        .mockResolvedValueOnce(['42', ['avail:v1:res-1:2026-05-01', 'avail:v1:res-1:2026-05-02']])
        .mockResolvedValueOnce(['0', []]);
      mockRedis.del.mockResolvedValue(2);

      await cacheManager.invalidateResource('res-1');

      expect(mockRedis.del).toHaveBeenCalledWith(
        'avail:v1:res-1:2026-05-01',
        'avail:v1:res-1:2026-05-02',
      );
    });

    it('does not throw when Redis scan fails', async () => {
      mockRedis.scan.mockRejectedValue(new Error('CLUSTERDOWN'));
      await expect(cacheManager.invalidateResource('res-1')).resolves.not.toThrow();
    });
  });

  // ── buildSlots ──────────────────────────────────────────────────────────────

  describe('buildSlots() static helper', () => {
    it('generates exactly 96 slots for a day (15-min granularity)', () => {
      const slots = AvailabilityCacheManager.buildSlots('2026-05-01', [], []);
      expect(slots).toHaveLength(96);
    });

    it('marks slots overlapping a booking as BOOKED', () => {
      const booking: BookingRecord = {
        id:         'b1',
        resourceId: 'res-1',
        startTime:  new Date('2026-05-01T08:00:00.000Z'),
        endTime:    new Date('2026-05-01T09:00:00.000Z'),
        status:     'APPROVED',
      };

      const slots = AvailabilityCacheManager.buildSlots('2026-05-01', [booking], []);
      // 08:00–09:00 = 4 slots of 15 min
      const bookedSlots = slots.filter((s) => s.status === 'BOOKED');
      expect(bookedSlots).toHaveLength(4);
    });

    it('marks slots overlapping a maintenance window as MAINTENANCE', () => {
      const maintenance = {
        startTime: new Date('2026-05-01T10:00:00.000Z'),
        endTime:   new Date('2026-05-01T10:30:00.000Z'),
      };

      const slots = AvailabilityCacheManager.buildSlots('2026-05-01', [], [maintenance]);
      const maintenanceSlots = slots.filter((s) => s.status === 'MAINTENANCE');
      expect(maintenanceSlots).toHaveLength(2);
    });

    it('MAINTENANCE takes priority over BOOKED for the same slot', () => {
      const booking: BookingRecord = {
        id: 'b1', resourceId: 'r1',
        startTime: new Date('2026-05-01T10:00:00.000Z'),
        endTime:   new Date('2026-05-01T10:15:00.000Z'),
        status:    'APPROVED',
      };
      const maintenance = {
        startTime: new Date('2026-05-01T10:00:00.000Z'),
        endTime:   new Date('2026-05-01T10:15:00.000Z'),
      };

      const slots = AvailabilityCacheManager.buildSlots('2026-05-01', [booking], [maintenance]);
      const slot  = slots.find((s) => s.startTime === '2026-05-01T10:00:00.000Z');
      expect(slot?.status).toBe('MAINTENANCE');
    });

    it('leaves non-overlapping slots as FREE', () => {
      const booking: BookingRecord = {
        id: 'b1', resourceId: 'r1',
        startTime: new Date('2026-05-01T08:00:00.000Z'),
        endTime:   new Date('2026-05-01T09:00:00.000Z'),
        status:    'APPROVED',
      };

      const slots = AvailabilityCacheManager.buildSlots('2026-05-01', [booking], []);
      const freeSlots = slots.filter((s) => s.status === 'FREE');
      expect(freeSlots).toHaveLength(92); // 96 - 4 booked
    });
  });
});
