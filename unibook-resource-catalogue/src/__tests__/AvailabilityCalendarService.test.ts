// src/__tests__/AvailabilityCalendarService.test.ts
// Tests for the Template Method cache pattern:
//   cache hit → return cached directly
//   cache miss → load from DB → build slots → populate cache → return

import { AvailabilityCalendarService } from '../services/AvailabilityCalendarService';
import type { AvailabilityCalendar, BookingRecord } from '../types';

// ── Mock dependencies ────────────────────────────────────────────────────────

const mockCacheManager = {
  getAvailability: jest.fn(),
  setAvailability: jest.fn(),
};

const mockResourceRepo = {
  findById:              jest.fn(),
  findBookingsForResource: jest.fn(),
  findMaintenanceWindows: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AvailabilityCalendarService', () => {
  let service: AvailabilityCalendarService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AvailabilityCalendarService(
      mockResourceRepo as never,
      mockCacheManager as never,
    );
  });

  describe('getAvailability() — cache HIT path', () => {
    it('returns cached calendar immediately without hitting the DB', async () => {
      const cached: AvailabilityCalendar = {
        resourceId:   'res-1',
        resourceName: 'Seminar Room',
        date:         '2026-05-01',
        slots:        [],
        cachedAt:     new Date().toISOString(),
        fromCache:    true,
      };
      mockCacheManager.getAvailability.mockResolvedValue(cached);

      const result = await service.getAvailability('res-1', '2026-05-01');

      expect(result.fromCache).toBe(true);
      expect(mockResourceRepo.findById).not.toHaveBeenCalled();
      expect(mockResourceRepo.findBookingsForResource).not.toHaveBeenCalled();
    });
  });

  describe('getAvailability() — cache MISS path', () => {
    beforeEach(() => {
      mockCacheManager.getAvailability.mockResolvedValue(null);
      mockResourceRepo.findById.mockResolvedValue({ id: 'res-1', name: 'Room A101' });
      mockResourceRepo.findBookingsForResource.mockResolvedValue([]);
      mockResourceRepo.findMaintenanceWindows.mockResolvedValue([]);
      mockCacheManager.setAvailability.mockResolvedValue(undefined);
    });

    it('calls DB and returns 96 15-minute slots', async () => {
      const result = await service.getAvailability('res-1', '2026-05-01');
      expect(result.slots).toHaveLength(96);
    });

    it('returns fromCache=false on a DB hit', async () => {
      const result = await service.getAvailability('res-1', '2026-05-01');
      expect(result.fromCache).toBe(false);
    });

    it('populates the cache after a DB read', async () => {
      await service.getAvailability('res-1', '2026-05-01');
      // setAvailability is fire-and-forget; give the micro-task queue a tick
      await new Promise((r) => setImmediate(r));
      expect(mockCacheManager.setAvailability).toHaveBeenCalledWith(
        'res-1',
        '2026-05-01',
        expect.objectContaining({ resourceId: 'res-1' }),
        undefined,
      );
    });

    it('marks slots correctly when bookings exist', async () => {
      const booking: BookingRecord = {
        id:         'b1',
        resourceId: 'res-1',
        startTime:  new Date('2026-05-01T09:00:00.000Z'),
        endTime:    new Date('2026-05-01T10:00:00.000Z'),
        status:     'APPROVED',
      };
      mockResourceRepo.findBookingsForResource.mockResolvedValue([booking]);

      const result = await service.getAvailability('res-1', '2026-05-01');
      const bookedSlots = result.slots.filter((s) => s.status === 'BOOKED');
      expect(bookedSlots).toHaveLength(4); // 09:00–10:00 = 4 × 15min
    });

    it('uses resource name from DB in the calendar', async () => {
      mockResourceRepo.findById.mockResolvedValue({ id: 'res-1', name: 'GPU Cluster Node 1' });

      const result = await service.getAvailability('res-1', '2026-05-01');
      expect(result.resourceName).toBe('GPU Cluster Node 1');
    });

    it('falls back to resourceId as name when resource not found', async () => {
      mockResourceRepo.findById.mockResolvedValue(null);

      const result = await service.getAvailability('res-1', '2026-05-01');
      expect(result.resourceName).toBe('res-1');
    });
  });
});
