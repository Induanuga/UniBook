// src/__tests__/ResourceRepository.test.ts
// Tests for database access layer — ResourceRepository.
// Mocks the PostgreSQL pool to verify SQL queries and row mapping.

import { ResourceRepository } from '../repositories/ResourceRepository';
import type { Resource, MaintenanceWindow } from '../types';

// ── Mock PostgreSQL pool ───────────────────────────────────────────────────────
const mockPool = {
  query: jest.fn(),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDatabaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    name: 'Seminar Room A101',
    type_id: 'SEMINAR_ROOM',
    location: 'Block A, Floor 1',
    capacity: 30,
    description: 'A comfortable seminar room',
    amenities: ['projector', 'whiteboard'], // Already parsed as array
    is_active: true,
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResourceRepository', () => {
  let repo: ResourceRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new ResourceRepository(mockPool as never);
  });

  describe('findById()', () => {
    it('returns a resource when found', async () => {
      const row = makeDatabaseRow();
      mockPool.query.mockResolvedValue({ rows: [row] });

      const result = await repo.findById('res-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('res-1');
      expect(result?.name).toBe('Seminar Room A101');
      expect(result?.typeId).toBe('SEMINAR_ROOM');
      expect(result?.capacity).toBe(30);
      expect(result?.amenities).toEqual(['projector', 'whiteboard']);
    });

    it('returns null when resource not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repo.findById('non-existent');

      expect(result).toBeNull();
    });

    it('maps database row to Resource type correctly', async () => {
      const row = makeDatabaseRow({
        type_id: 'LAB',
        capacity: 50,
        amenities: ['microscope', 'fume hood'],
      });
      mockPool.query.mockResolvedValue({ rows: [row] });

      const result = await repo.findById('res-1');

      expect(result?.typeId).toBe('LAB');
      expect(result?.capacity).toBe(50);
      expect(result?.amenities).toEqual(['microscope', 'fume hood']);
    });

    it('handles database errors gracefully', async () => {
      mockPool.query.mockRejectedValue(new Error('Connection failed'));

      await expect(repo.findById('res-1')).rejects.toThrow('Connection failed');
    });
  });

  describe('findAllTypes()', () => {
    it('returns all resource types', async () => {
      const types = [
        { id: 'SEMINAR_ROOM', name: 'Seminar Room', description: 'Small meeting space' },
        { id: 'LAB', name: 'Laboratory', description: 'Research lab' },
      ];
      mockPool.query.mockResolvedValue({ rows: types });

      const result = await repo.findAllTypes();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('SEMINAR_ROOM');
      expect(result[1].id).toBe('LAB');
    });

    it('returns empty array when no types exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repo.findAllTypes();

      expect(result).toEqual([]);
    });
  });

  describe('findBookingsForResource()', () => {
    it('returns bookings within date range', async () => {
      const bookings = [
        {
          id: 'booking-1',
          resource_id: 'res-1',
          start_time: '2026-05-01T10:00:00Z',
          end_time: '2026-05-01T11:00:00Z',
          status: 'APPROVED',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: bookings });

      const result = await repo.findBookingsForResource(
        'res-1',
        new Date('2026-05-01'),
        new Date('2026-05-02'),
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('booking-1');
    });

    it('returns empty array when no bookings exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repo.findBookingsForResource(
        'res-1',
        new Date('2026-05-01'),
        new Date('2026-05-02'),
      );

      expect(result).toEqual([]);
    });
  });

  describe('findMaintenanceWindows()', () => {
    it('returns maintenance windows for a resource', async () => {
      const windows = [
        {
          id: 'maint-1',
          resource_id: 'res-1',
          start_time: '2026-05-01T10:00:00Z',
          end_time: '2026-05-01T12:00:00Z',
          reason: 'Cleaning',
          created_by: 'staff-1',
          created_at: '2026-05-01T09:00:00Z',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: windows });

      const result = await repo.findMaintenanceWindows(
        'res-1',
        new Date('2026-05-01'),
        new Date('2026-05-02'),
      );

      expect(result).toHaveLength(1);
      expect(result[0].reason).toBe('Cleaning');
      expect(result[0].resourceId).toBe('res-1');
    });

    it('returns empty array when no maintenance windows exist', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repo.findMaintenanceWindows(
        'res-1',
        new Date('2026-05-01'),
        new Date('2026-05-02'),
      );

      expect(result).toEqual([]);
    });
  });

  describe('create()', () => {
    it('creates a new resource and returns it', async () => {
      const newRow = makeDatabaseRow({ id: 'res-new' });
      mockPool.query.mockResolvedValue({ rows: [newRow] });

      const result = await repo.create(
        {
          name: 'Seminar Room A101',
          typeId: 'SEMINAR_ROOM',
          location: 'Block A, Floor 1',
          capacity: 30,
          description: 'A comfortable seminar room',
          amenities: ['projector', 'whiteboard'],
        },
        'admin-user',
      );

      expect(result.id).toBe('res-new');
      expect(result.name).toBe('Seminar Room A101');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO resources'),
        expect.any(Array),
      );
    });
  });

  describe('search()', () => {
    it('returns resources matching search filters', async () => {
      const resources = [makeDatabaseRow()];
      mockPool.query.mockResolvedValue({ rows: resources });

      const result = await repo.search({ type: 'SEMINAR_ROOM' }, 50);

      expect(result).toHaveLength(1);
      expect(result[0].typeId).toBe('SEMINAR_ROOM');
    });

    it('returns empty array when no matches found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repo.search({ type: 'SEMINAR_ROOM' }, 50);

      expect(result).toEqual([]);
    });

    it('handles capacity range filtering', async () => {
      const resources = [makeDatabaseRow({ capacity: 25 })];
      mockPool.query.mockResolvedValue({ rows: resources });

      const result = await repo.search(
        {
          minCapacity: 20,
          maxCapacity: 30,
        },
        50,
      );

      expect(result).toHaveLength(1);
      expect(result[0].capacity).toBe(25);
    });
  });
});
