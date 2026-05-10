// src/__tests__/policies.test.ts
// Unit tests for IBookingPolicy implementations (Strategy pattern — ADR-003).
// No DB connection needed — policies are pure logic (except QuotaPolicy).

import { FIFOPolicy }     from '../policies/FIFOPolicy';
import { PriorityPolicy } from '../policies/PriorityPolicy';
import type { JWTPayload, BookingRequest } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeUser(role: JWTPayload['role']): JWTPayload {
  return {
    jti:        'test-jti',
    sub:        'user-1',
    email:      'test@uni.edu',
    name:       'Test User',
    role,
    department: 'CS',
  };
}

function makeRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h from now
  const end   = new Date(start.getTime() + 60 * 60 * 1000); // 1h duration
  return {
    resourceId:     'res-1',
    startTime:      start.toISOString(),
    endTime:        end.toISOString(),
    purpose:        'Project meeting',
    attendeeCount:  5,
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

// ── FIFOPolicy ────────────────────────────────────────────────────────────────
describe('FIFOPolicy', () => {
  const policy = new FIFOPolicy();

  test('allows a valid booking request', async () => {
    const result = await policy.validate(makeRequest(), makeUser('STUDENT'));
    expect(result.allowed).toBe(true);
  });

  test('rejects when end time equals start time', async () => {
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const result = await policy.validate(makeRequest({ startTime: start, endTime: start }), makeUser('STUDENT'));
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/end time/i);
  });

  test('rejects booking duration exceeding 8 hours', async () => {
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const end   = new Date(start.getTime() + 9 * 60 * 60 * 1000); // 9h
    const result = await policy.validate(
      makeRequest({ startTime: start.toISOString(), endTime: end.toISOString() }),
      makeUser('STUDENT'),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/8 hours/i);
  });

  test('allows FACULTY with a valid request', async () => {
    const result = await policy.validate(makeRequest(), makeUser('FACULTY'));
    expect(result.allowed).toBe(true);
  });
});

// ── PriorityPolicy ────────────────────────────────────────────────────────────
describe('PriorityPolicy', () => {
  const policy = new PriorityPolicy({ facultyWindowMinutes: 30 });

  test('allows FACULTY booking within priority window', async () => {
    // Faculty can always book
    const start = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
    const end   = new Date(start.getTime() + 60 * 60 * 1000);
    const result = await policy.validate(
      makeRequest({ startTime: start.toISOString(), endTime: end.toISOString() }),
      makeUser('FACULTY'),
    );
    expect(result.allowed).toBe(true);
  });

  test('blocks STUDENT booking within 30-min priority window', async () => {
    const start = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now (< 30 min window)
    const end   = new Date(start.getTime() + 60 * 60 * 1000);
    const result = await policy.validate(
      makeRequest({ startTime: start.toISOString(), endTime: end.toISOString() }),
      makeUser('STUDENT'),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/priority/i);
  });

  test('allows STUDENT booking outside priority window', async () => {
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h from now (> 30 min)
    const end   = new Date(start.getTime() + 60 * 60 * 1000);
    const result = await policy.validate(
      makeRequest({ startTime: start.toISOString(), endTime: end.toISOString() }),
      makeUser('STUDENT'),
    );
    expect(result.allowed).toBe(true);
  });

  test('rejects booking exceeding 12 hours', async () => {
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const end   = new Date(start.getTime() + 13 * 60 * 60 * 1000);
    const result = await policy.validate(
      makeRequest({ startTime: start.toISOString(), endTime: end.toISOString() }),
      makeUser('FACULTY'),
    );
    expect(result.allowed).toBe(false);
  });
});

// ── BookingPolicyRegistry ─────────────────────────────────────────────────────
describe('BookingPolicyRegistry — runtime registration', () => {
  test('returns registered policy for resource type', async () => {
    const { BookingPolicyRegistry } = await import('../policies/BookingPolicyRegistry');
    // Provide a stub pool — load() won't be called here
    const mockPool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as never;
    const registry = new BookingPolicyRegistry(mockPool);

    const customPolicy = { validate: jest.fn().mockResolvedValue({ allowed: true }) };
    registry.register('CUSTOM_ROOM', customPolicy);

    const retrieved = registry.getPolicyFor('CUSTOM_ROOM');
    expect(retrieved).toBe(customPolicy);
  });

  test('falls back to FIFOPolicy for unknown resource type', async () => {
    const { BookingPolicyRegistry } = await import('../policies/BookingPolicyRegistry');
    const mockPool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as never;
    const registry = new BookingPolicyRegistry(mockPool);
    const policy = registry.getPolicyFor('UNKNOWN_TYPE');
    expect(policy).toBeInstanceOf(FIFOPolicy);
  });
});
