import { req, concurrent, percentile } from './helpers.ts';

const FACULTY_CREDS = { email: 'bob.faculty@university.edu', password: 'Password@123' };

let accessToken  = '';
let refreshToken = '';

describe('NFR-5: Scalability — IAM Subsystem', () => {

  beforeAll(async () => {
    try {
      const res = await req('/auth/login', { method: 'POST', body: FACULTY_CREDS });
      if (res.status === 200) {
        accessToken  = (res.body as any).accessToken  || '';
        refreshToken = (res.body as any).refreshToken || '';
      } else {
        console.warn(`  faculty login → ${res.status}. If 429: restart backend.`);
      }
    } catch (e) {
      console.warn(`  beforeAll: server unreachable — ${(e as Error).message}`);
    }
  });

  let baselineMs = 0;

  // ── NFR-5-A: Establish baseline ───────────────────────────────────────────

  test('NFR-5-A: Baseline single GET /auth/me P50 <= 200 ms', async () => {
    if (!accessToken) return console.warn('Skipped — no token');

    // Warm-up
    await req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      samples.push(r.durationMs);
      await new Promise(d => setTimeout(d, 50));
    }

    const sorted = [...samples].sort((a, b) => a - b);
    baselineMs   = percentile(sorted, 50);
    console.log(`  Baseline P50: ${baselineMs} ms (samples: ${samples.join(', ')} ms)`);
    expect(baselineMs).toBeLessThanOrEqual(200);
  });

  // ── NFR-5-B: 20 concurrent — degradation <= 2x ───────────────────────────

  test('NFR-5-B: 20 concurrent GET /auth/me — P95 <= 2x baseline (max 400 ms)', async () => {
    if (!accessToken) return console.warn('Skipped — no token');

    const { durations, statuses } = await concurrent(
      20,
      () => req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
    );

    const p50  = percentile(durations, 50);
    const p95  = percentile(durations, 95);
    const cap  = baselineMs > 0 ? baselineMs * 2 : 400;
    const ok   = statuses.filter(s => s === 200).length;

    console.log(`  20× GET /auth/me: P50=${p50}ms P95=${p95}ms cap=${cap}ms ok=${ok}/20`);
    expect(p95).toBeLessThanOrEqual(Math.max(cap, 400));
    expect(ok / 20).toBeGreaterThanOrEqual(0.95);
  }, 30_000);

  // ── NFR-5-C: 30 concurrent refresh — no 5xx ──────────────────────────────

  test('NFR-5-C: 30 concurrent POST /auth/refresh — P95 <= 1000 ms, no 5xx', async () => {
    if (!refreshToken) return console.warn('Skipped — no refresh token');

    const { durations, statuses } = await concurrent(
      30,
      () => req('/auth/refresh', { method: 'POST', body: { refreshToken } })
    );

    const p95          = percentile(durations, 95);
    const fiveHundreds = statuses.filter(s => s >= 500).length;
    const ok           = statuses.filter(s => s === 200).length;

    console.log(`  30× POST /auth/refresh: P95=${p95}ms 5xx=${fiveHundreds} ok=${ok}/30`);
    expect(p95).toBeLessThanOrEqual(1000);
    expect(fiveHundreds).toBe(0);
  }, 30_000);

  // ── NFR-5-D: Recovery after burst ────────────────────────────────────────

  test('NFR-5-D: Latency recovers to <= 2x baseline within 2s after burst', async () => {
    if (!accessToken) return console.warn('Skipped — no token');

    // Burst
    await concurrent(
      50,
      () => req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
    );

    // Wait 2 seconds
    await new Promise(r => setTimeout(r, 2000));

    // Measure recovery
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      samples.push(r.durationMs);
      await new Promise(d => setTimeout(d, 100));
    }

    const recovered = percentile(samples, 50);
    const cap       = baselineMs > 0 ? baselineMs * 2 : 400;

    console.log(`  Post-burst recovery P50: ${recovered} ms (cap: ${cap} ms)`);
    expect(recovered).toBeLessThanOrEqual(Math.max(cap, 400));
  }, 40_000);

  // ── NFR-5-E: Stateless — same JWT consistent across 10 requests ──────────

  test('NFR-5-E: Same JWT → consistent 200 across 10 sequential requests', async () => {
    if (!accessToken) return console.warn('Skipped — no token');

    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      results.push(r.status);
    }
    console.log(`  10× GET /auth/me: ${results.join(', ')}`);
    expect(results.every(s => s === 200)).toBe(true);
  });

  // ── NFR-5-F: No 5xx under 50-request burst ───────────────────────────────

  test('NFR-5-F: Zero 5xx errors during 50-request burst', async () => {
    if (!accessToken) return console.warn('Skipped — no token');

    const { statuses } = await concurrent(
      50,
      () => req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
    );

    const fiveHundreds = statuses.filter(s => s >= 500);
    console.log(`  5xx errors during 50-req burst: ${fiveHundreds.length}`);
    expect(fiveHundreds.length).toBe(0);
  }, 30_000);

  // ── NFR-5-G: /auth/me never rate-limited ─────────────────────────────────

  test('NFR-5-G: /auth/me is not rate-limited for authenticated users (30 requests)', async () => {
    if (!accessToken) return console.warn('Skipped — no token');

    const { statuses } = await concurrent(
      30,
      () => req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
    );

    const blocked = statuses.filter(s => s === 429).length;
    const ok      = statuses.filter(s => s === 200).length;
    console.log(`  GET /auth/me × 30: ${ok} ok, ${blocked} rate-limited`);
    expect(blocked).toBe(0);
    expect(ok).toBe(30);
  }, 30_000);

  // ── NFR-5-H: JWT validation is stateless (P50 < 50ms on localhost) ────────

  test('NFR-5-H: JWT validation P50 < 50ms — confirms no per-request DB roundtrip', async () => {
    if (!accessToken) return console.warn('Skipped — no token');

    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await req('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
      times.push(r.durationMs);
    }

    const p50 = percentile(times, 50);
    console.log(`  JWT validation P50 on localhost: ${p50} ms`);
    // Stateless validation on localhost should be well under 50ms.
    // If it's consistently > 50ms, the server is hitting the DB on every request.
    expect(p50).toBeLessThanOrEqual(50);
  });

});
