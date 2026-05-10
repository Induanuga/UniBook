import { req, concurrent, percentile } from './helpers.ts';

// IT_STAFF — separate from student/admin used by NFR-2
const TEST_USER = { email: 'dave.it@university.edu', password: 'Password@123' };

let accessToken  = '';
let refreshToken = '';

describe('NFR-1: Performance — IAM Subsystem', () => {

  beforeAll(async () => {
    try {
      const res = await req('/auth/login', { method: 'POST', body: TEST_USER });
      if (res.status === 200) {
        accessToken  = (res.body as any).accessToken  || '';
        refreshToken = (res.body as any).refreshToken || '';
      } else {
        console.warn(`  beforeAll login → ${res.status}. If 429: restart backend to reset rate limit.`);
      }
    } catch (e) {
      console.warn(`  beforeAll: server unreachable — ${(e as Error).message}`);
    }
  });

  // ── NFR-1-A: Single login ────────────────────────────────────────────────

  test('NFR-1-A: Single POST /auth/login responds within 1000 ms', async () => {
    const res = await req('/auth/login', { method: 'POST', body: TEST_USER });
    console.log(`  POST /auth/login: ${res.durationMs} ms (status ${res.status})`);
    if (res.status === 429) return console.warn('  Rate-limited — restart backend to reset window');
    expect(res.durationMs).toBeLessThanOrEqual(1000);
  });

  // ── NFR-1-B: GET /auth/me ─────────────────────────────────────────────────

  test('NFR-1-B: GET /auth/me responds within 200 ms', async () => {
    if (!accessToken) return console.warn('  Skipped: no token');
    const res = await req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    console.log(`  GET /auth/me: ${res.durationMs} ms (status ${res.status})`);
    expect(res.status).toBe(200);
    expect(res.durationMs).toBeLessThanOrEqual(200);
  });

  // ── NFR-1-C: POST /auth/refresh ──────────────────────────────────────────

  test('NFR-1-C: POST /auth/refresh responds within 500 ms', async () => {
    if (!refreshToken) return console.warn('  Skipped: no refresh token');
    const res = await req('/auth/refresh', { method: 'POST', body: { refreshToken } });
    console.log(`  POST /auth/refresh: ${res.durationMs} ms (status ${res.status})`);
    expect(res.status).toBe(200);
    expect(res.durationMs).toBeLessThanOrEqual(500);
  });

  // ── NFR-1-D/E: Unauthorised rejection within 100 ms ──────────────────────

  test('NFR-1-D: No-token request rejected within 100 ms', async () => {
    const res = await req('/auth/me');
    console.log(`  GET /auth/me (no token): ${res.durationMs} ms → ${res.status}`);
    expect(res.status).toBe(401);
    expect(res.durationMs).toBeLessThanOrEqual(100);
  });

  test('NFR-1-E: Invalid-token request rejected within 100 ms', async () => {
    const res = await req('/auth/me', { headers: { Authorization: 'Bearer not.a.real.jwt' } });
    console.log(`  GET /auth/me (bad token): ${res.durationMs} ms → ${res.status}`);
    expect(res.status).toBe(401);
    expect(res.durationMs).toBeLessThanOrEqual(100);
  });

  // ── NFR-1-F/G: Concurrent GET /auth/me (no rate-limit risk) ──────────────

  test('NFR-1-F: 20 concurrent GET /auth/me — P95 <= 500 ms', async () => {
    if (!accessToken) return console.warn('  Skipped: no access token');

    const { durations, statuses } = await concurrent(
      20,
      () => req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
    );

    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const ok  = statuses.filter(s => s === 200).length;

    console.log(`  20× GET /auth/me: P50=${p50}ms P95=${p95}ms success=${ok}/20`);
    expect(p95).toBeLessThanOrEqual(500);
    expect(ok).toBe(20);
  }, 30_000);

  test('NFR-1-G: 30 concurrent GET /auth/me — P95 <= 500 ms', async () => {
    if (!accessToken) return console.warn('  Skipped: no access token');

    const { durations, statuses } = await concurrent(
      30,
      () => req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
    );

    const p95 = percentile(durations, 95);
    const ok  = statuses.filter(s => s === 200).length;

    console.log(`  30× GET /auth/me: P95=${p95}ms success=${ok}/30`);
    expect(p95).toBeLessThanOrEqual(500);
  }, 30_000);

  // ── NFR-1-H: Health check ─────────────────────────────────────────────────

  test('NFR-1-H: GET /health responds within 50 ms', async () => {
    const res = await req('/health');
    console.log(`  GET /health: ${res.durationMs} ms → ${res.status}`);
    expect(res.status).toBe(200);
    expect(res.durationMs).toBeLessThanOrEqual(50);
  });

  // ── NFR-1-I: Concurrent refresh ───────────────────────────────────────────

  test('NFR-1-I: 10 concurrent POST /auth/refresh — no 5xx errors', async () => {
    if (!refreshToken) return console.warn('  Skipped: no refresh token');

    const { durations, statuses } = await concurrent(
      10,
      () => req('/auth/refresh', { method: 'POST', body: { refreshToken } })
    );

    const p95          = percentile(durations, 95);
    const fiveHundreds = statuses.filter(s => s >= 500).length;

    console.log(`  10× POST /auth/refresh: P95=${p95}ms 5xx=${fiveHundreds}`);
    expect(p95).toBeLessThanOrEqual(1000);
    expect(fiveHundreds).toBe(0);
  }, 30_000);

});
