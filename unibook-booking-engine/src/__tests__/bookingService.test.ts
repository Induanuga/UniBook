// src/__tests__/bookingService.test.ts
// Unit tests for BookingService — all DB interactions mocked.

import { BookingService }          from '../services/BookingService';
import { BookingPolicyRegistry }   from '../policies/BookingPolicyRegistry';
import { FIFOPolicy }              from '../policies/FIFOPolicy';
import { eventBus }                from '../events/EventBus';
import type { JWTPayload, BookingRequest } from '../types';

function makeUser(role: JWTPayload['role'] = 'STUDENT'): JWTPayload {
  return {
    jti:        'jti-1',
    sub:        'user-1',
    email:      'student@uni.edu',
    name:       'Alice',
    role,
    department: 'CS',
  };
}

function makeRequest(): BookingRequest {
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const end   = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    resourceId:     'res-1',
    startTime:      start.toISOString(),
    endTime:        end.toISOString(),
    purpose:        'Group project',
    attendeeCount:  4,
    idempotencyKey: 'idem-1',
  };
}

const BOOKING_RECORD = {
  id:             'book-1',
  resource_id:    'res-1',
  user_id:        'user-1',
  user_email:     'student@uni.edu',
  user_role:      'STUDENT',
  department:     'CS',
  start_time:     new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  end_time:       new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  purpose:        'Group project',
  attendee_count: 4,
  status:         'PENDING',
  idempotency_key:'idem-1',
  version:        1,
  created_at:     new Date().toISOString(),
  updated_at:     new Date().toISOString(),
};

function makePool(conflictRows: object[] = [], insertRows: object[] = [BOOKING_RECORD]) {
  return {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return Promise.resolve({ rows: conflictRows });
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO bookings')) {
          return Promise.resolve({ rows: insertRows });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    }),
    query: jest.fn().mockResolvedValue({ rows: [] }),
  };
}

afterEach(() => {
  eventBus.removeAllListeners();
  jest.clearAllMocks();
});

describe('BookingService.submitBooking()', () => {
  test('returns success=true and booking when no conflict', async () => {
    const pool     = makePool([], [BOOKING_RECORD]);
    const registry = new BookingPolicyRegistry(pool as never);
    registry.register('SEMINAR_ROOM', new FIFOPolicy());

    const service = new BookingService(pool as never, registry);
    const result  = await service.submitBooking(makeRequest(), makeUser(), 'SEMINAR_ROOM', 'corr-1');

    expect(result.success).toBe(true);
    expect(result.booking).toBeDefined();
    expect(result.booking!.id).toBe('book-1');
  });

  test('returns SLOT_CONFLICT with suggestions when conflict found', async () => {
    const pool = makePool([BOOKING_RECORD], []);
    const registry = new BookingPolicyRegistry(pool as never);
    registry.register('SEMINAR_ROOM', new FIFOPolicy());

    const service = new BookingService(pool as never, registry);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)['slotService'] = {
      findNextAvailable: jest.fn().mockResolvedValue([
        { startTime: 'T1', endTime: 'T2' },
        { startTime: 'T3', endTime: 'T4' },
        { startTime: 'T5', endTime: 'T6' },
      ]),
    };

    const result = await service.submitBooking(makeRequest(), makeUser(), 'SEMINAR_ROOM', 'corr-2');
    expect(result.success).toBe(false);
    expect(result.code).toBe('SLOT_CONFLICT');
    expect(result.suggestions).toHaveLength(3);
  });

  test('publishes BookingSubmitted event after successful insert', async () => {
    const pool     = makePool([], [BOOKING_RECORD]);
    const registry = new BookingPolicyRegistry(pool as never);
    registry.register('SEMINAR_ROOM', new FIFOPolicy());

    const service    = new BookingService(pool as never, registry);
    const publishSpy = jest.spyOn(eventBus, 'publish');

    await service.submitBooking(makeRequest(), makeUser(), 'SEMINAR_ROOM', 'corr-3');
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'BookingSubmitted', bookingId: 'book-1' }),
    );
  });

  test('does NOT publish event when conflict occurs', async () => {
    const pool = makePool([BOOKING_RECORD], []);
    const registry = new BookingPolicyRegistry(pool as never);
    registry.register('SEMINAR_ROOM', new FIFOPolicy());
    const service = new BookingService(pool as never, registry);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)['slotService'] = {
      findNextAvailable: jest.fn().mockResolvedValue([]),
    };

    const publishSpy = jest.spyOn(eventBus, 'publish');
    await service.submitBooking(makeRequest(), makeUser(), 'SEMINAR_ROOM', 'corr-4');
    expect(publishSpy).not.toHaveBeenCalled();
  });

  test('returns POLICY_REJECTED when policy denies request', async () => {
    const pool     = makePool([], []);
    const registry = new BookingPolicyRegistry(pool as never);
    registry.register('RESTRICTED', {
      validate: jest.fn().mockResolvedValue({ allowed: false, reason: 'Not allowed.' }),
    });

    const service = new BookingService(pool as never, registry);
    const result  = await service.submitBooking(makeRequest(), makeUser(), 'RESTRICTED', 'corr-5');

    expect(result.success).toBe(false);
    expect(result.code).toBe('POLICY_REJECTED');
    expect(result.error).toBe('Not allowed.');
  });

  test('rolls back transaction on DB error and releases client', async () => {
    const client = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN') return Promise.resolve({ rows: [] });
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return Promise.reject(new Error('DB error'));
        }
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const pool = {
      connect: jest.fn().mockResolvedValue(client),
      query:   jest.fn().mockResolvedValue({ rows: [] }),
    };
    const registry = new BookingPolicyRegistry(pool as never);
    registry.register('SEMINAR_ROOM', new FIFOPolicy());

    const service = new BookingService(pool as never, registry);

    await expect(
      service.submitBooking(makeRequest(), makeUser(), 'SEMINAR_ROOM'),
    ).rejects.toThrow('DB error');

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('BookingService.cancelBooking()', () => {
  test('returns null when booking not found', async () => {
    const pool = {
      connect: jest.fn(),
      query:   jest.fn().mockResolvedValue({ rows: [] }),
    };
    const registry = new BookingPolicyRegistry(pool as never);
    const service  = new BookingService(pool as never, registry);

    const result = await service.cancelBooking('non-existent', 'user-1', 'STUDENT');
    expect(result).toBeNull();
  });
});
