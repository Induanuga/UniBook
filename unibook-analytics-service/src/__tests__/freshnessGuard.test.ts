// src/__tests__/freshnessGuard.test.ts
// Unit tests for FreshnessGuard — NFR-1 (Performance / Data Freshness)
//
// Verifies:
//   1. isFresh = true when last snapshot is within the 5-minute threshold.
//   2. isFresh = false when last snapshot is older than 5 minutes.
//   3. isFresh = false when no snapshots exist (null from repo).
//   4. ageSeconds is correctly computed.
//   5. thresholdSeconds matches STALE_THRESHOLD_MS / 1000.
//   6. Custom threshold is respected.
//   7. AnalyticsService.getFreshnessStatus() delegates to FreshnessGuard.

import { FreshnessGuard, STALE_THRESHOLD_MS } from '../services/FreshnessGuard';
import type { AnalyticsRepository } from '../repositories/AnalyticsRepository';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockRepo(lastRefreshedAt: Date | null): Pick<AnalyticsRepository, 'getLastSnapshotRefreshedAt'> {
  return {
    getLastSnapshotRefreshedAt: jest.fn().mockResolvedValue(lastRefreshedAt),
  };
}

afterEach(() => jest.clearAllMocks());

// ── 1. Fresh snapshot ─────────────────────────────────────────────────────────

describe('FreshnessGuard.check() — fresh snapshot', () => {
  test('returns isFresh = true when snapshot is 1 minute old', async () => {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const repo = makeMockRepo(oneMinuteAgo);
    const guard = new FreshnessGuard(repo as never);

    const status = await guard.check();

    expect(status.isFresh).toBe(true);
    expect(status.lastRefreshedAt).toEqual(oneMinuteAgo);
    expect(status.ageSeconds).toBeLessThan(STALE_THRESHOLD_MS / 1000);
  });

  test('returns isFresh = true when snapshot is exactly at threshold boundary', async () => {
    // Exactly at threshold — should still be fresh (<=)
    const exactlyAtThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);
    const repo = makeMockRepo(exactlyAtThreshold);
    const guard = new FreshnessGuard(repo as never);

    const status = await guard.check();

    expect(status.isFresh).toBe(true);
  });
});

// ── 2. Stale snapshot ─────────────────────────────────────────────────────────

describe('FreshnessGuard.check() — stale snapshot', () => {
  test('returns isFresh = false when snapshot is 6 minutes old', async () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60_000);
    const repo = makeMockRepo(sixMinutesAgo);
    const guard = new FreshnessGuard(repo as never);

    const status = await guard.check();

    expect(status.isFresh).toBe(false);
    expect(status.ageSeconds).toBeGreaterThan(STALE_THRESHOLD_MS / 1000);
  });

  test('returns isFresh = false when snapshot is 1 hour old', async () => {
    const oneHourAgo = new Date(Date.now() - 3600_000);
    const repo = makeMockRepo(oneHourAgo);
    const guard = new FreshnessGuard(repo as never);

    const status = await guard.check();

    expect(status.isFresh).toBe(false);
    expect(status.ageSeconds).toBeGreaterThanOrEqual(3600);
  });
});

// ── 3. No snapshots ───────────────────────────────────────────────────────────

describe('FreshnessGuard.check() — no snapshots', () => {
  test('returns isFresh = false and null lastRefreshedAt when table is empty', async () => {
    const repo = makeMockRepo(null);
    const guard = new FreshnessGuard(repo as never);

    const status = await guard.check();

    expect(status.isFresh).toBe(false);
    expect(status.lastRefreshedAt).toBeNull();
    expect(status.ageSeconds).toBeNull();
  });
});

// ── 4. ageSeconds accuracy ────────────────────────────────────────────────────

describe('FreshnessGuard.check() — ageSeconds', () => {
  test('ageSeconds is approximately correct (within 2 s of actual age)', async () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
    const repo = makeMockRepo(twoMinutesAgo);
    const guard = new FreshnessGuard(repo as never);

    const status = await guard.check();

    expect(status.ageSeconds).toBeGreaterThanOrEqual(119);
    expect(status.ageSeconds).toBeLessThanOrEqual(122);
  });
});

// ── 5. thresholdSeconds ───────────────────────────────────────────────────────

describe('FreshnessGuard.check() — thresholdSeconds', () => {
  test('thresholdSeconds matches STALE_THRESHOLD_MS / 1000 (300 s)', async () => {
    const repo = makeMockRepo(new Date());
    const guard = new FreshnessGuard(repo as never);

    const status = await guard.check();

    expect(status.thresholdSeconds).toBe(STALE_THRESHOLD_MS / 1000);
    expect(status.thresholdSeconds).toBe(300);
  });
});

// ── 6. Custom threshold ───────────────────────────────────────────────────────

describe('FreshnessGuard — custom threshold', () => {
  test('respects a custom threshold of 60 s', async () => {
    const ninetySecondsAgo = new Date(Date.now() - 90_000);
    const repo = makeMockRepo(ninetySecondsAgo);
    const guard = new FreshnessGuard(repo as never, 60_000); // 60 s threshold

    const status = await guard.check();

    expect(status.isFresh).toBe(false);
    expect(status.thresholdSeconds).toBe(60);
  });

  test('returns isFresh = true with 60 s threshold when snapshot is 30 s old', async () => {
    const thirtySecondsAgo = new Date(Date.now() - 30_000);
    const repo = makeMockRepo(thirtySecondsAgo);
    const guard = new FreshnessGuard(repo as never, 60_000);

    const status = await guard.check();

    expect(status.isFresh).toBe(true);
  });
});

// ── 7. AnalyticsService integration ──────────────────────────────────────────

describe('AnalyticsService.getFreshnessStatus()', () => {
  test('delegates to FreshnessGuard and returns status', async () => {
    const { AnalyticsService } = await import('../services/AnalyticsService');

    const pool = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const service = new AnalyticsService(pool as never);

    const mockStatus = {
      isFresh: true,
      lastRefreshedAt: new Date(),
      ageSeconds: 30,
      thresholdSeconds: 300,
    };

    // Inject mock freshness guard
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)['freshness'] = { check: jest.fn().mockResolvedValue(mockStatus) };

    const result = await service.getFreshnessStatus();

    expect(result).toEqual(mockStatus);
    expect(result.isFresh).toBe(true);
    expect(result.thresholdSeconds).toBe(300);
  });

  test('returns isFresh = false when snapshots are stale', async () => {
    const { AnalyticsService } = await import('../services/AnalyticsService');

    const pool = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const service = new AnalyticsService(pool as never);

    const staleStatus = {
      isFresh: false,
      lastRefreshedAt: new Date(Date.now() - 10 * 60_000),
      ageSeconds: 600,
      thresholdSeconds: 300,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)['freshness'] = { check: jest.fn().mockResolvedValue(staleStatus) };

    const result = await service.getFreshnessStatus();

    expect(result.isFresh).toBe(false);
    expect(result.ageSeconds).toBeGreaterThan(result.thresholdSeconds!);
  });
});

// ── 8. NFR-1 constraint ───────────────────────────────────────────────────────

describe('NFR-1 constraint', () => {
  test('STALE_THRESHOLD_MS is exactly 5 minutes (300 000 ms)', () => {
    expect(STALE_THRESHOLD_MS).toBe(300_000);
  });
});
