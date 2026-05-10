// src/__tests__/idempotencyGuard.test.ts
// Unit tests for IdempotencyGuard (Tactic 1 — duplicate booking prevention).

import { IdempotencyGuard } from '../services/IdempotencyGuard';

function makePool(rows: object[] = []) {
  return {
    query: jest.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  };
}

describe('IdempotencyGuard', () => {
  test('check() returns null for a fresh key', async () => {
    const pool  = makePool([]);            // no rows → fresh
    const guard = new IdempotencyGuard(pool as never);
    const result = await guard.check('new-key-uuid');
    expect(result).toBeNull();
  });

  test('check() returns cached response for a duplicate key', async () => {
    const cachedBody = { success: true, booking: { id: 'b-1' } };
    const pool = makePool([{ status_code: 201, response: cachedBody }]);
    const guard = new IdempotencyGuard(pool as never);

    const result = await guard.check('existing-key');
    expect(result).not.toBeNull();
    expect(result!.statusCode).toBe(201);
    expect(result!.body).toEqual(cachedBody);
  });

  test('record() calls INSERT with correct parameters', async () => {
    const pool  = makePool();
    const guard = new IdempotencyGuard(pool as never);

    await guard.record('key-123', 'booking-456', 201, { success: true });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO idempotency_keys'),
      expect.arrayContaining(['key-123', 'booking-456', 201]),
    );
  });

  test('check() queries with the provided key value', async () => {
    const pool  = makePool([]);
    const guard = new IdempotencyGuard(pool as never);
    await guard.check('my-unique-key');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('idempotency_keys'),
      expect.arrayContaining(['my-unique-key']),
    );
  });
});
