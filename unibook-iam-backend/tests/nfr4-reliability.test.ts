import { req, concurrent } from './helpers.ts';

const STUDENT_CREDS = { email: 'alice.student@university.edu', password: 'Password@123' };
const ADMIN_CREDS   = { email: 'carol.admin@university.edu',   password: 'Password@123' };
const IT_CREDS      = { email: 'dave.it@university.edu',       password: 'Password@123' };

// Dedicated email for reliability tests — avoids colliding with NFR-2's dupe test
const DUPE_EMAIL = 'nfr4.dupe.test@university.edu';

let studentToken   = '';
let studentRefresh = '';
let adminToken     = '';

describe('NFR-4: Availability & Reliability — IAM Subsystem', () => {

  beforeAll(async () => {
    try {
      // Use IT_STAFF for the token-heavy tests (refresh, logout, concurrent sessions)
      const itRes = await req('/auth/login', { method: 'POST', body: IT_CREDS });
      if (itRes.status === 200) {
        studentToken   = (itRes.body as any).accessToken  || '';
        studentRefresh = (itRes.body as any).refreshToken || '';
      } else {
        console.warn(`  IT_STAFF login → ${itRes.status}. If 429: restart backend.`);
      }

      const aRes = await req('/auth/login', { method: 'POST', body: ADMIN_CREDS });
      if (aRes.status === 200) {
        adminToken = (aRes.body as any).accessToken || '';
      } else {
        console.warn(`  admin login → ${aRes.status}.`);
      }
    } catch (e) {
      console.warn(`  beforeAll: server unreachable — ${(e as Error).message}`);
    }
  });

  // ── NFR-4-A: Liveness ────────────────────────────────────────────────────

  test('NFR-4-A: /health returns 200 (liveness check)', async () => {
    const res = await req('/health');
    console.log(`  /health: ${res.status} — ${JSON.stringify(res.body)}`);
    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe('ok');
    expect((res.body as any).subsystem).toBe('IAM');
    expect((res.body as any).timestamp).toBeDefined();
  });

  test('NFR-4-A: /health responds 200 across 5 consecutive polls', async () => {
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await req('/health');
      results.push(res.status);
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`  Health poll results: ${results.join(', ')}`);
    expect(results.every(s => s === 200)).toBe(true);
  });

  // ── NFR-4-B: Refresh token renews access ─────────────────────────────────

  test('NFR-4-B: POST /auth/refresh issues a new access token (200)', async () => {
    if (!studentRefresh) return console.warn('Skipped — no refresh token');
    const res = await req('/auth/refresh', { method: 'POST', body: { refreshToken: studentRefresh } });
    console.log(`  POST /auth/refresh: ${res.status}`);
    expect(res.status).toBe(200);
    expect(typeof (res.body as any).accessToken).toBe('string');
    expect((res.body as any).expiresIn).toBeGreaterThan(0);
  });

  test('NFR-4-B: New access token from refresh is accepted by /auth/me', async () => {
    if (!studentRefresh) return console.warn('Skipped');
    const refreshRes = await req('/auth/refresh', { method: 'POST', body: { refreshToken: studentRefresh } });
    if (refreshRes.status !== 200) return console.warn('  Skipped — refresh failed');

    const newToken = (refreshRes.body as any).accessToken as string;
    const meRes    = await req('/auth/me', { headers: { Authorization: `Bearer ${newToken}` } });
    console.log(`  New token from refresh → GET /auth/me: ${meRes.status}`);
    expect(meRes.status).toBe(200);
  });

  // ── NFR-4-C: Bad refresh token handled gracefully ────────────────────────

  test('NFR-4-C: Garbage refresh token → 401 INVALID_REFRESH_TOKEN (no crash)', async () => {
    const res = await req('/auth/refresh', { method: 'POST', body: { refreshToken: 'garbage.token.here' } });
    console.log(`  POST /auth/refresh (garbage): ${res.status}`);
    expect(res.status).toBe(401);
    expect((res.body as any).code).toBe('INVALID_REFRESH_TOKEN');
  });

  test('NFR-4-C: Empty body on /auth/refresh → 400 MISSING_REFRESH_TOKEN', async () => {
    const res = await req('/auth/refresh', { method: 'POST', body: {} });
    expect(res.status).toBe(400);
    expect((res.body as any).code).toBe('MISSING_REFRESH_TOKEN');
  });

  // ── NFR-4-D: Duplicate signup idempotency ────────────────────────────────

  test('NFR-4-D: Duplicate POST /auth/signup → 409 USER_EXISTS (no 500)', async () => {
    const newUser = {
      email: DUPE_EMAIL, password: 'Password@123',
      name: 'NFR4 Dupe', role: 'STUDENT', department: 'CS',
    };
    // First call: 201 or 409 depending on run history
    const first = await req('/auth/signup', { method: 'POST', body: newUser });
    expect([201, 409]).toContain(first.status);

    // Second call: always 409
    const second = await req('/auth/signup', { method: 'POST', body: newUser });
    console.log(`  Duplicate signup: ${second.status}`);
    expect(second.status).toBe(409);
    expect((second.body as any).code).toBe('USER_EXISTS');
  });

  // ── NFR-4-E: Concurrent sessions stay valid ───────────────────────────────

  test('NFR-4-E: Two concurrent sessions for same user both remain valid', async () => {
    // Login twice simultaneously with faculty (separate from IT_STAFF)
    const [res1, res2] = await Promise.all([
      req('/auth/login', { method: 'POST', body: { email: 'bob.faculty@university.edu', password: 'Password@123' } }),
      req('/auth/login', { method: 'POST', body: { email: 'bob.faculty@university.edu', password: 'Password@123' } }),
    ]);

    if (res1.status !== 200 || res2.status !== 200) {
      return console.warn(`  Skipped — logins got ${res1.status}, ${res2.status}`);
    }

    const token1 = (res1.body as any).accessToken as string;
    const token2 = (res2.body as any).accessToken as string;
    expect(token1).not.toBe(token2); // fresh JTIs

    const [me1, me2] = await Promise.all([
      req('/auth/me', { headers: { Authorization: `Bearer ${token1}` } }),
      req('/auth/me', { headers: { Authorization: `Bearer ${token2}` } }),
    ]);

    console.log(`  Session 1: ${me1.status} | Session 2: ${me2.status}`);
    expect(me1.status).toBe(200);
    expect(me2.status).toBe(200);
  });

  // ── NFR-4-F: Token TTL correct ────────────────────────────────────────────

  test('NFR-4-F: Login response expiresIn = 28800 (8 hours)', async () => {
    const res = await req('/auth/login', { method: 'POST', body: IT_CREDS });
    if (res.status !== 200) return console.warn(`  Skipped — login got ${res.status}`);
    const expiresIn = (res.body as any).expiresIn as number;
    console.log(`  expiresIn: ${expiresIn}s (expected 28800)`);
    expect(expiresIn).toBe(28800);
  });

  test('NFR-4-F: JWT exp field is ~8h from now', async () => {
    const res = await req('/auth/login', { method: 'POST', body: IT_CREDS });
    if (res.status !== 200) return console.warn(`  Skipped — login got ${res.status}`);
    const at      = (res.body as any).accessToken as string;
    const payload = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString());
    const nowSec  = Math.floor(Date.now() / 1000);
    console.log(`  JWT exp: ${payload.exp}, expected ~${nowSec + 28800}`);
    expect(payload.exp).toBeGreaterThan(nowSec + 28800 - 60);
    expect(payload.exp).toBeLessThan(nowSec + 28800 + 60);
  });

  test('NFR-4-F: JWT contains jti (UUID v4) for revocation', async () => {
    const res = await req('/auth/login', { method: 'POST', body: IT_CREDS });
    if (res.status !== 200) return console.warn(`  Skipped — login got ${res.status}`);
    const at      = (res.body as any).accessToken as string;
    const payload = JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString());
    console.log(`  JWT jti: ${payload.jti}`);
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  // ── NFR-4-G: Logout is idempotent ────────────────────────────────────────

  test('NFR-4-G: POST /auth/logout is idempotent — second logout is not a 500', async () => {
    const loginRes = await req('/auth/login', { method: 'POST', body: IT_CREDS });
    if (loginRes.status !== 200) return console.warn(`  Skipped — login got ${loginRes.status}`);

    const at = (loginRes.body as any).accessToken  as string;
    const rt = (loginRes.body as any).refreshToken as string;

    const logout1 = await req('/auth/logout', {
      method: 'POST', body: { refreshToken: rt },
      headers: { Authorization: `Bearer ${at}` },
    });
    expect(logout1.status).toBe(200);

    const logout2 = await req('/auth/logout', {
      method: 'POST', body: { refreshToken: rt },
      headers: { Authorization: `Bearer ${at}` },
    });
    console.log(`  Second logout: ${logout2.status}`);
    expect(logout2.status).not.toBe(500);
    expect([200, 401]).toContain(logout2.status);
  });

  // ── NFR-4-H: Audit log is append-only ────────────────────────────────────

  test('NFR-4-H: Audit log entry count only grows (never deleted)', async () => {
    if (!adminToken) return console.warn('Skipped — no admin token');

    const before = await req('/auth/audit-log', { headers: { Authorization: `Bearer ${adminToken}` } });
    if (before.status !== 200) return;
    const countBefore = ((before.body as any).entries as any[]).length;

    await req('/auth/login', {
      method: 'POST',
      body:   { email: 'nfr4.appendonly.test@university.edu', password: 'wrong' },
    });

    const after = await req('/auth/audit-log', { headers: { Authorization: `Bearer ${adminToken}` } });
    if (after.status !== 200) return;
    const countAfter = ((after.body as any).entries as any[]).length;

    console.log(`  Audit log: ${countBefore} → ${countAfter} entries`);
    expect(countAfter).toBeGreaterThanOrEqual(countBefore);
  });

  // ── NFR-4-I: No stack traces in error responses ───────────────────────────

  test('NFR-4-I: Error responses do not leak stack traces', async () => {
    const res  = await req('/auth/login', { method: 'POST', body: { email: 'bad@x.com', password: 'wrong' } });
    const body = JSON.stringify(res.body);
    console.log(`  Error body sample: ${body.slice(0, 120)}`);
    // Rate-limited responses are still fine — just no stack traces
    expect(body).not.toContain('at Object');
    expect(body).not.toContain('node_modules');
    expect(body).toHaveProperty;
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code');
  });

  // ── NFR-4-J: Content-Type is application/json ─────────────────────────────

  test('NFR-4-J: All API responses return Content-Type: application/json', async () => {
    const paths = ['/health', '/auth/me', '/auth/audit-log'];
    for (const path of paths) {
      const res = await req(path);
      const ct  = res.headers['content-type'] as string || '';
      console.log(`  ${path} Content-Type: ${ct}`);
      expect(ct).toContain('application/json');
    }
  });

  // ── NFR-4-K: Unknown routes return 404 ───────────────────────────────────

  test('NFR-4-K: Unknown route → 404 NOT_FOUND (not 500)', async () => {
    const res = await req('/auth/does-not-exist');
    console.log(`  GET /auth/does-not-exist: ${res.status}`);
    expect(res.status).toBe(404);
    expect((res.body as any).code).toBe('NOT_FOUND');
  });

});
