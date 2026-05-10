// src/__tests__/ResourceSearchEngine.test.ts
// Tests for the Specification-pattern search engine.
// Mocks ResourceRepository and AvailabilityCalendarService.

import { ResourceSearchEngine }    from '../services/ResourceSearchEngine';
import type { Resource, ResourceWithAvailability } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id:           'res-1',
    name:         'Seminar Room A101',
    typeId:       'SEMINAR_ROOM',
    resourceType: 'SEMINAR_ROOM',
    location:     'Block A, Floor 1',
    capacity:     30,
    description:  '',
    isActive:     true,
    amenities:    ['projector', 'whiteboard'],
    version:      1,
    createdAt:    new Date(),
    updatedAt:    new Date(),
    ...overrides,
  };
}

// ── Mock dependencies ────────────────────────────────────────────────────────

const mockResourceRepo = {
  search: jest.fn(),
};

const mockAvailabilityService = {
  getAvailability: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ResourceSearchEngine', () => {
  let engine: ResourceSearchEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new ResourceSearchEngine(
      mockResourceRepo as never,
      mockAvailabilityService as never,
    );
  });

  it('returns all active resources when no filters are given', async () => {
    const resources = [makeResource(), makeResource({ id: 'res-2', name: 'Lab B201' })];
    mockResourceRepo.search.mockResolvedValue(resources);

    const result = await engine.search({});
    expect(result).toHaveLength(2);
  });

  it('post-filters inactive resources even if DB returns them', async () => {
    // DB should never return inactive resources with our query, but the spec
    // layer is a safety net to enforce the invariant at the application layer.
    const resources = [
      makeResource({ isActive: true }),
      makeResource({ id: 'res-2', isActive: false }),
    ];
    mockResourceRepo.search.mockResolvedValue(resources);

    const result = await engine.search({});
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('res-1');
  });

  it('filters by type specification', async () => {
    const resources = [
      makeResource({ typeId: 'SEMINAR_ROOM', resourceType: 'SEMINAR_ROOM' }),
      makeResource({ id: 'res-2', typeId: 'LAB', resourceType: 'LAB' }),
    ];
    mockResourceRepo.search.mockResolvedValue(resources);

    const result = await engine.search({ type: 'SEMINAR_ROOM' });
    expect(result).toHaveLength(1);
    expect(result[0].typeId).toBe('SEMINAR_ROOM');
  });

  it('filters by minCapacity specification', async () => {
    const resources = [
      makeResource({ id: 'small', capacity: 10 }),
      makeResource({ id: 'large', capacity: 40 }),
    ];
    mockResourceRepo.search.mockResolvedValue(resources);

    const result = await engine.search({ minCapacity: 20 });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('large');
  });

  it('filters by location specification (case-insensitive)', async () => {
    const resources = [
      makeResource({ id: 'r1', location: 'Block A, Floor 1' }),
      makeResource({ id: 'r2', location: 'Block B, Floor 2' }),
    ];
    mockResourceRepo.search.mockResolvedValue(resources);

    const result = await engine.search({ location: 'block a' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
  });

  it('filters by amenities — all required amenities must be present', async () => {
    const resources = [
      makeResource({ id: 'full',    amenities: ['projector', 'whiteboard', 'ac'] }),
      makeResource({ id: 'partial', amenities: ['projector'] }),
    ];
    mockResourceRepo.search.mockResolvedValue(resources);

    const result = await engine.search({ amenities: ['projector', 'whiteboard'] });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('full');
  });

  it('attaches availability summary when date is provided', async () => {
    const resources = [makeResource()];
    mockResourceRepo.search.mockResolvedValue(resources);
    mockAvailabilityService.getAvailability.mockResolvedValue({
      resourceId: 'res-1',
      date:       '2026-05-01',
      slots:      [
        { startTime: '2026-05-01T08:00:00.000Z', endTime: '2026-05-01T08:15:00.000Z', status: 'FREE' },
        { startTime: '2026-05-01T08:15:00.000Z', endTime: '2026-05-01T08:30:00.000Z', status: 'BOOKED' },
      ],
      fromCache: false,
      cachedAt:  new Date().toISOString(),
    });

    const result = await engine.search({ date: '2026-05-01' }) as ResourceWithAvailability[];

    expect(result[0].availabilitySummary).toBeDefined();
    expect(result[0].availabilitySummary!.freeSlots).toBe(1);
    expect(result[0].availabilitySummary!.hasAvailability).toBe(true);
  });

  it('degrades gracefully if availability fetch fails for one resource', async () => {
    const resources = [makeResource(), makeResource({ id: 'res-2' })];
    mockResourceRepo.search.mockResolvedValue(resources);
    mockAvailabilityService.getAvailability
      .mockResolvedValueOnce({ slots: [], fromCache: false, cachedAt: '', resourceId: 'res-1', date: '', resourceName: '' })
      .mockRejectedValueOnce(new Error('Redis timeout'));

    const result = await engine.search({ date: '2026-05-01' });
    // Both resources still returned — no availability summary on the failing one
    expect(result).toHaveLength(2);
  });
});
