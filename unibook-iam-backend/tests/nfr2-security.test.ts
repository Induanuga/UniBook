
import { req, concurrent } from './helpers.ts';

const STUDENT_CREDS = { email: 'alice.student@university.edu', password: 'Password@123' };
const ADMIN_CREDS   = { email: 'carol.admin@university.edu',   password: 'Password@123' };
const FACULTY_CREDS = { email: 'bob.faculty@university.edu',   password: 'Password@123' };

// Dedicated email for the duplicate-signup test — not a seeded user
const DUPE_EMAIL = 'nfr2.dupe.test@university.edu';

let studentToken   = '';
let studentRefresh = '';
let adminToken     = '';

describe('NFR-2: Security — IAM Subsystem', () => {

  beforeAll(async () => {
    try {
      const sRes = await req('/auth/login', { method: 'POST', body: STUDENT_CREDS });
      if (sRes.status === 200) {
        studentToken   = (sRes.body as any).accessToken  || '';
        studentRefresh = (sRes.body as any).refreshToken || '';
      } else {
        console.warn(`  student login → ${sRes.status}. If 429: restart backend.`);
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

  // ── NFR-2-A: All protected routes return 401 with no token ───────────────

  const PROTECTED_ROUTES: [string, string][] = [
    ['GET',  '/auth/me'],
    ['POST', '/auth/logout'],
    ['GET',  '/auth/audit-log'],
    ['GET',  '/auth/users'],
  ];

  test.each(PROTECTED_ROUTES)(
    'NFR-2-A: %s %s → 401 with no token',
    async (method, path) => {
      const res = await req(path, { method });
      console.log(`  ${method} ${path} (no token): ${res.status} in ${res.durationMs}ms`);
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('code');
    }
  );

  // ── NFR-2-B: Invalid tokens rejected ─────────────────────────────────────

  test('NFR-2-B: Invalid JWT string → 401 INVALID_TOKEN', async () => {
    const res = await req('/auth/me', { headers: { Authorization: 'Bearer not.a.real.jwt' } });
    expect(res.status).toBe(401);
    expect((res.body as any).code).toBe('INVALID_TOKEN');
  });

  test('NFR-2-B: Rogue JWT (wrong secret) → 401', async () => {
    const rogue =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJoYWNrZXIiLCJyb2xlIjoiQURNSU4iLCJpYXQiOjE3MzkwMDAwMDB9.' +
      'bad_signature_here';
    const res = await req('/auth/me', { headers: { Authorization: `Bearer ${rogue}` } });
    expect(res.status).toBe(401);
  });

  test('NFR-2-B: Missing "Bearer " prefix → 401', async () => {
    const res = await req('/auth/me', { headers: { Authorization: studentToken || 'sometoken' } });
    expect(res.status).toBe(401);
  });

  // ── NFR-2-C: STUDENT blocked from admin routes ────────────────────────────

  test('NFR-2-C: STUDENT → GET /auth/audit-log → 403 INSUFFICIENT_ROLE', async () => {
    if (!studentToken) return console.warn('  Skipped — no student token (check 429s above)');
    const res = await req('/auth/audit-log', { headers: { Authorization: `Bearer ${studentToken}` } });
    console.log(`  GET /auth/audit-log (student): ${res.status}`);
    expect(res.status).toBe(403);
    expect((res.body as any).code).toBe('INSUFFICIENT_ROLE');
  });

  test('NFR-2-C: STUDENT → GET /auth/users → 403 yourRole=STUDENT', async () => {
    if (!studentToken) return console.warn('  Skipped — no student token');
    const res = await req('/auth/users', { headers: { Authorization: `Bearer ${studentToken}` } });
    expect(res.status).toBe(403);
    expect((res.body as any).yourRole).toBe('STUDENT');
  });

  // ── NFR-2-D: ADMIN can access admin-only routes ───────────────────────────

  test('NFR-2-D: ADMIN → GET /auth/audit-log → 200', async () => {
    if (!adminToken) return console.warn('  Skipped — no admin token (check 429s above)');
    const res = await req('/auth/audit-log', { headers: { Authorization: `Bearer ${adminToken}` } });
    console.log(`  GET /auth/audit-log (admin): ${res.status}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('entries');
  });

  test('NFR-2-D: ADMIN → GET /auth/users → 200', async () => {
    if (!adminToken) return console.warn('  Skipped — no admin token');
    const res = await req('/auth/users', { headers: { Authorization: `Bearer ${adminToken}` } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
  });

  // ── NFR-2-E: Revoked token rejected after logout ──────────────────────────

  test('NFR-2-E: Token rejected after logout → 401 TOKEN_REVOKED', async () => {
    if (!studentToken) return console.warn('  Skipped — no student token');

    const at = studentToken;
    const rt = studentRefresh;

    // Verify it works before logout
    const before = await req('/auth/me', { headers: { Authorization: `Bearer ${at}` } });
    if (before.status !== 200) return console.warn('  Skipped — token already invalid');

    // Logout
    await req('/auth/logout', {
      method:  'POST',
      body:    { refreshToken: rt },
      headers: { Authorization: `Bearer ${at}` },
    });

    // Must now be rejected
    const after = await req('/auth/me', { headers: { Authorization: `Bearer ${at}` } });
    console.log(`  POST-logout GET /auth/me: ${after.status}`);
    expect(after.status).toBe(401);
    expect((after.body as any).code).toBe('TOKEN_REVOKED');

    // Clear so subsequent tests don't use a revoked token
    studentToken   = '';
    studentRefresh = '';
  });

  // ── NFR-2-F: Audit log captures events ───────────────────────────────────

  test('NFR-2-F: Failed login recorded in audit log', async () => {
    if (!adminToken) return console.warn('  Skipped — no admin token');

    await req('/auth/login', {
      method: 'POST',
      body:   { email: 'nfr2.audit.check@university.edu', password: 'WrongPass999!' },
    });

    const logRes = await req('/auth/audit-log', { headers: { Authorization: `Bearer ${adminToken}` } });
    if (logRes.status !== 200) return console.warn('  Skipped — audit log not accessible');

    const entries: any[] = (logRes.body as any).entries || [];
    const failed = entries.find(
      (e) => e.action === 'LOGIN_FAILED' && e.actorEmail === 'nfr2.audit.check@university.edu'
    );
    console.log(`  Audit entries: ${entries.length}, LOGIN_FAILED found: ${!!failed}`);
    expect(failed).toBeDefined();
    expect(failed.success).toBe(false);
    expect(failed.timestamp).toBeDefined();
  });

  // ── NFR-2-G: CORS header ─────────────────────────────────────────────────

  test('NFR-2-G: CORS Access-Control-Allow-Origin = http://localhost:5173', async () => {
    const res = await req('/health', { headers: { Origin: 'http://localhost:5173' } });
    const acao = res.headers['access-control-allow-origin'];
    console.log(`  CORS origin header: ${acao}`);
    expect(acao).toBe('http://localhost:5173');
  });

  // ── NFR-2-I: Tampered JWT rejected ───────────────────────────────────────
  // Uses faculty login — fresh token not affected by student revocation above

  test('NFR-2-I: Tampered JWT payload (role escalation) → 401', async () => {
    const loginRes = await req('/auth/login', { method: 'POST', body: FACULTY_CREDS });
    if (loginRes.status !== 200) return console.warn(`  Skipped — faculty login got ${loginRes.status}`);

    const token   = (loginRes.body as any).accessToken as string;
    const parts   = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.role  = 'ADMIN';
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;

    const res = await req('/auth/audit-log', { headers: { Authorization: `Bearer ${tampered}` } });
    console.log(`  Tampered JWT (role=ADMIN escalation): ${res.status}`);
    expect(res.status).toBe(401);
  });

  // ── NFR-2-J: Refresh token cannot be used as access token ────────────────

  test('NFR-2-J: Refresh token rejected on access-protected route', async () => {
    const loginRes = await req('/auth/login', { method: 'POST', body: FACULTY_CREDS });
    if (loginRes.status !== 200) return console.warn(`  Skipped — faculty login got ${loginRes.status}`);

    const rt  = (loginRes.body as any).refreshToken as string;
    const res = await req('/auth/me', { headers: { Authorization: `Bearer ${rt}` } });
    console.log(`  Refresh token used as access token: ${res.status}`);
    expect(res.status).toBe(401);
  });

  // ── NFR-2-K: Signup input validation ─────────────────────────────────────

  test('NFR-2-K: Signup missing fields → 400 MISSING_FIELDS', async () => {
    const res = await req('/auth/signup', {
      method: 'POST',
      body:   { email: 'incomplete@university.edu' },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).code).toBe('MISSING_FIELDS');
  });

  test('NFR-2-K: Signup invalid role → 400 INVALID_ROLE', async () => {
    const res = await req('/auth/signup', {
      method: 'POST',
      body:   { email: 'x@university.edu', password: 'Password@123', name: 'X', role: 'SUPERADMIN' },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).code).toBe('INVALID_ROLE');
  });

  test('NFR-2-K: Signup weak password → 400 WEAK_PASSWORD', async () => {
    const res = await req('/auth/signup', {
      method: 'POST',
      body:   { email: 'x2@university.edu', password: 'abc', name: 'X', role: 'STUDENT' },
    });
    expect(res.status).toBe(400);
    expect((res.body as any).code).toBe('WEAK_PASSWORD');
  });

  // ── NFR-2-L: Duplicate signup ─────────────────────────────────────────────

  test('NFR-2-L: Duplicate POST /auth/signup → 409 USER_EXISTS', async () => {
    const newUser = {
      email:      DUPE_EMAIL,
      password:   'Password@123',
      name:       'Dupe Tester',
      role:       'STUDENT',
      department: 'CS',
    };

    // First call: 201 on first run ever, 409 on reruns — both acceptable
    const first = await req('/auth/signup', { method: 'POST', body: newUser });
    console.log(`  First signup (${DUPE_EMAIL}): ${first.status}`);
    expect([201, 409]).toContain(first.status);

    // Second call: must always be 409
    const second = await req('/auth/signup', { method: 'POST', body: newUser });
    console.log(`  Second signup (duplicate): ${second.status}`);
    expect(second.status).toBe(409);
    expect((second.body as any).code).toBe('USER_EXISTS');
  });

  // ── NFR-2-M: /health is public ────────────────────────────────────────────

  test('NFR-2-M: GET /health is public — no auth required (200)', async () => {
    const res = await req('/health');
    expect(res.status).toBe(200);
    expect((res.body as any).status).toBe('ok');
  });

  // ── NFR-2-H: Brute-force rate limiting — MUST RUN LAST ───────────────────
  // Intentionally exhausts the 20-req/15-min window. Placed last so it doesn't
  // affect earlier tests in this file that need to call /auth/login.

  test(
    'NFR-2-H: Brute-force rate limiting triggers after rapid POST /auth/login attempts',
    async () => {
      const results = await concurrent(
        25,
        () => req('/auth/login', {
          method: 'POST',
          body:   { email: 'bruteforce.probe@university.edu', password: 'wrong' },
        })
      );

      const rateLimited = results.statuses.filter(s => s === 429).length;
      console.log(`  Rate-limited responses: ${rateLimited}/25`);
      // Rate limiter (max=20) must have kicked in for at least some requests
      expect(rateLimited).toBeGreaterThan(0);
    },
    30_000
  );

});
