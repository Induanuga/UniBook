// src/__tests__/conflictDetection.test.ts
// Unit tests for ConflictDetectionEngine (ASR-1, FR-4).

import { ConflictDetectionEngine } from '../services/ConflictDetectionEngine';

const NOW    = new Date('2026-05-01T10:00:00Z');
const PLUS1H = new Date('2026-05-01T11:00:00Z');
const PLUS2H = new Date('2026-05-01T12:00:00Z');

function makeClient(rows: object[] = []) {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  };
}

const BOOKING_ROW = {
  id:             'b-1',
  resource_id:    'res-1',
  user_id:        'u-1',
  user_email:     'a@uni.edu',
  user_role:      'STUDENT',
  department:     'CS',
  start_time:     NOW.toISOString(),
  end_time:       PLUS1H.toISOString(),
  purpose:        'study',
  attendee_count: 2,
  status:         'PENDING',
  idempotency_key:'idem-1',
  version:        1,
  created_at:     NOW.toISOString(),
  updated_at:     NOW.toISOString(),
};

describe('ConflictDetectionEngine', () => {
  const pool   = {} as never;
  const engine = new ConflictDetectionEngine(pool);

  test('returns hasConflict=false when no rows returned', async () => {
    const client = makeClient([]);
    const result = await engine.check('res-1', NOW, PLUS1H, client as never);
    expect(result.hasConflict).toBe(false);
    expect(result.conflicting).toHaveLength(0);
  });

  test('returns hasConflict=true with conflicting bookings', async () => {
    const client = makeClient([BOOKING_ROW]);
    const result = await engine.check('res-1', NOW, PLUS1H, client as never);
    expect(result.hasConflict).toBe(true);
    expect(result.conflicting).toHaveLength(1);
    expect(result.conflicting[0].id).toBe('b-1');
  });

  test('uses SELECT FOR UPDATE in the SQL query', async () => {
    const client = makeClient([]);
    await engine.check('res-1', NOW, PLUS1H, client as never);
    const sql: string = (client.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/FOR UPDATE/i);
  });

  test('passes resource_id and time window as parameters', async () => {
    const client = makeClient([]);
    await engine.check('res-99', NOW, PLUS2H, client as never, 'corr-1');
    const params = (client.query as jest.Mock).mock.calls[0][1] as string[];
    expect(params[0]).toBe('res-99');
    expect(params).toContain(NOW.toISOString());
    expect(params).toContain(PLUS2H.toISOString());
  });

  test('maps multiple conflicting rows correctly', async () => {
    const row2 = { ...BOOKING_ROW, id: 'b-2', status: 'APPROVED' };
    const client = makeClient([BOOKING_ROW, row2]);
    const result = await engine.check('res-1', NOW, PLUS2H, client as never);
    expect(result.conflicting).toHaveLength(2);
    expect(result.conflicting.map((b) => b.id)).toEqual(['b-1', 'b-2']);
  });
});
