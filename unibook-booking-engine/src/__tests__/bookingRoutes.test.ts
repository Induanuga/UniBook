// src/__tests__/bookingRoutes.test.ts
// HTTP-level integration tests for the Booking Engine REST API.
// Uses supertest with a fully mocked BookingFacade — no DB or JWT required.

import express from 'express';
import request from 'supertest';
import jwt     from 'jsonwebtoken';
import { createBookingRouter } from '../routes/bookingRoutes';
import { correlationIdMiddleware } from '../middleware/correlationId';
import { eventBus } from '../events/EventBus';

// ── JWT test helper ───────────────────────────────────────────────────────────
const TEST_SECRET = process.env.JWT_SECRET!;

function signToken(role = 'STUDENT', sub = 'user-1') {
  return jwt.sign(
    { jti: 'test-jti', sub, email: 'test@uni.edu', name: 'Test', role, department: 'CS' },
    TEST_SECRET,
    { issuer: 'unibook-iam', audience: 'unibook-api', expiresIn: '1h' },
  );
}

// ── Shared booking object ─────────────────────────────────────────────────────
const BOOKING = {
  id:             'book-1',
  resourceId:     'res-1',
  userId:         'user-1',
  userEmail:      'test@uni.edu',
  userRole:       'STUDENT',
  department:     'CS',
  startTime:      new Date(Date.now() + 2 * 60 * 60 * 1000),
  endTime:        new Date(Date.now() + 3 * 60 * 60 * 1000),
  purpose:        'Meeting',
  attendeeCount:  3,
  status:         'PENDING',
  idempotencyKey: 'idem-1',
  version:        1,
  createdAt:      new Date(),
  updatedAt:      new Date(),
};

// ── Build test app with mocked facade ─────────────────────────────────────────
function buildApp(facadeOverrides: Record<string, jest.Mock> = {}) {
  const facade = {
    submitBooking:  jest.fn().mockResolvedValue({ statusCode: 201, body: { success: true, booking: BOOKING } }),
    getBooking:     jest.fn().mockResolvedValue(BOOKING),
    getMyBookings:  jest.fn().mockResolvedValue([BOOKING]),
    cancelBooking:  jest.fn().mockResolvedValue({ ...BOOKING, status: 'CANCELLED' }),
    ...facadeOverrides,
  };

  const app = express();
  app.use(express.json());
  app.use(correlationIdMiddleware);
  app.use('/bookings', createBookingRouter(facade as never));
  return { app, facade };
}

afterEach(() => {
  eventBus.removeAllListeners();
  jest.clearAllMocks();
});

// ── POST /bookings ─────────────────────────────────────────────────────────────
describe('POST /bookings', () => {
  function validBody() {
    return {
      resourceId:    'res-1',
      startTime:     new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      endTime:       new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      purpose:       'Project meeting',
      attendeeCount: 4,
    };
  }

  test('201 — successfully creates a booking', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${signToken()}`)
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.booking.id).toBe('book-1');
  });

  test('401 — rejects request with no token', async () => {
    const { app } = buildApp();
    const res = await request(app).post('/bookings').send(validBody());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NO_TOKEN');
  });

  test('401 — rejects invalid JWT', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', 'Bearer not.a.real.token')
      .send(validBody());
    expect(res.status).toBe(401);
  });

  test('403 — IT_STAFF cannot submit bookings', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${signToken('IT_STAFF')}`)
      .send(validBody());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_ROLE');
  });

  test('400 — missing required field (purpose)', async () => {
    const { app } = buildApp();
    const { purpose: _p, ...body } = validBody();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${signToken()}`)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('400 — purpose exceeds 500 characters', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${signToken()}`)
      .send({ ...validBody(), purpose: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  test('400 — end time before start time', async () => {
    const { app } = buildApp();
    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const end   = new Date(start.getTime() - 30 * 60 * 1000); // end before start
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${signToken()}`)
      .send({ ...validBody(), startTime: start.toISOString(), endTime: end.toISOString() });
    expect(res.status).toBe(400);
  });

  test('409 — conflict response passes through with suggestions', async () => {
    const { app } = buildApp({
      submitBooking: jest.fn().mockResolvedValue({
        statusCode: 409,
        body: {
          success:     false,
          code:        'SLOT_CONFLICT',
          suggestions: [{ startTime: 'T1', endTime: 'T2' }],
        },
      }),
    });
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${signToken()}`)
      .send(validBody());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLOT_CONFLICT');
    expect(res.body.suggestions).toHaveLength(1);
  });

  test('X-Correlation-ID header is present in response', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/bookings')
      .set('Authorization', `Bearer ${signToken()}`)
      .send(validBody());
    expect(res.headers['x-correlation-id']).toBeDefined();
  });
});

// ── GET /bookings/mine ─────────────────────────────────────────────────────────
describe('GET /bookings/mine', () => {
  test('200 — returns bookings array', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get('/bookings/mine')
      .set('Authorization', `Bearer ${signToken()}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bookings)).toBe(true);
  });

  test('401 — no token', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/bookings/mine');
    expect(res.status).toBe(401);
  });
});

// ── GET /bookings/:id ──────────────────────────────────────────────────────────
describe('GET /bookings/:id', () => {
  test('200 — owner can fetch their own booking', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get('/bookings/book-1')
      .set('Authorization', `Bearer ${signToken('STUDENT', 'user-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('book-1');
  });

  test('403 — different user cannot see another user\'s booking', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get('/bookings/book-1')
      .set('Authorization', `Bearer ${signToken('STUDENT', 'other-user')}`);
    expect(res.status).toBe(403);
  });

  test('200 — ADMIN can see any booking', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get('/bookings/book-1')
      .set('Authorization', `Bearer ${signToken('ADMIN', 'admin-user')}`);
    expect(res.status).toBe(200);
  });

  test('404 — booking not found', async () => {
    const { app } = buildApp({ getBooking: jest.fn().mockResolvedValue(null) });
    const res = await request(app)
      .get('/bookings/missing')
      .set('Authorization', `Bearer ${signToken()}`);
    expect(res.status).toBe(404);
  });
});

// ── DELETE /bookings/:id ───────────────────────────────────────────────────────
describe('DELETE /bookings/:id', () => {
  test('200 — owner can cancel their booking', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .delete('/bookings/book-1')
      .set('Authorization', `Bearer ${signToken('STUDENT', 'user-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
  });

  test('404 — non-owner gets 404/forbidden response', async () => {
    const { app } = buildApp({ cancelBooking: jest.fn().mockResolvedValue(null) });
    const res = await request(app)
      .delete('/bookings/book-1')
      .set('Authorization', `Bearer ${signToken('STUDENT', 'other-user')}`);
    expect(res.status).toBe(404);
  });

  test('401 — unauthenticated cannot cancel', async () => {
    const { app } = buildApp();
    const res = await request(app).delete('/bookings/book-1');
    expect(res.status).toBe(401);
  });
});
