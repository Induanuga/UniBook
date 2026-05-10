// src/__tests__/analyticsRoutes.test.ts
// Integration-style tests for the Analytics REST API.
// All AnalyticsService calls are mocked — no DB required.

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createAnalyticsRouter } from '../routes/analyticsRoutes';
import type { AnalyticsService } from '../services/AnalyticsService';

// Must match the JWT_SECRET default in config
const JWT_SECRET = 'unibook-super-secret-key-change-in-production-min-256-bits';

function makeToken(role = 'ADMIN', userId = 'admin-1'): string {
  return jwt.sign(
    { jti: 'j1', sub: userId, email: 'admin@uni.edu', name: 'Admin', role, department: 'IT' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function makeMockService(overrides: Partial<Record<string, jest.Mock>> = {}): AnalyticsService {
  return {
    processEvent: overrides.processEvent ?? jest.fn().mockResolvedValue(undefined),
    getHeatmap:   overrides.getHeatmap   ?? jest.fn().mockResolvedValue({
      from: '2026-05-01', to: '2026-05-31', cells: [],
    }),
    getSummary:   overrides.getSummary   ?? jest.fn().mockResolvedValue({
      totalApproved: 5, totalCancelled: 1, totalSubmitted: 8, totalRejected: 2,
      from: '2026-05-01', to: '2026-05-31',
    }),
    exportCsv:    overrides.exportCsv    ?? jest.fn().mockResolvedValue('id,eventType\n'),
  } as unknown as AnalyticsService;
}

function buildApp(service: AnalyticsService) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.correlationId = 'test-corr'; next(); });
  app.use('/analytics', createAnalyticsRouter(service));
  return app;
}

afterEach(() => jest.clearAllMocks());

// ── POST /analytics/internal/event ───────────────────────────────────────────

describe('POST /analytics/internal/event', () => {
  const validPayload = {
    eventType:     'BookingApproved',
    correlationId: 'corr-1',
    bookingId:     'book-1',
    resourceId:    'res-1',
    userId:        'user-1',
    department:    'CS',
    startTime:     '2026-05-01T10:00:00.000Z',
    endTime:       '2026-05-01T12:00:00.000Z',
    timestamp:     new Date().toISOString(),
  };

  test('returns 202 with valid service key and payload', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .post('/analytics/internal/event')
      .set('X-Service-Key', JWT_SECRET)
      .send(validPayload);

    expect(res.status).toBe(202);
  });

  test('returns 401 without service key', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .post('/analytics/internal/event')
      .send(validPayload);

    expect(res.status).toBe(401);
  });

  test('returns 400 with missing required fields', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .post('/analytics/internal/event')
      .set('X-Service-Key', JWT_SECRET)
      .send({ eventType: 'BookingApproved' });   // missing bookingId, resourceId, etc.

    expect(res.status).toBe(400);
  });
});

// ── GET /analytics/heatmap ────────────────────────────────────────────────────

describe('GET /analytics/heatmap', () => {
  test('returns heatmap for ADMIN with valid date range', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/heatmap?from=2026-05-01&to=2026-05-31')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cells');
  });

  test('returns 403 for non-ADMIN role', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/heatmap?from=2026-05-01&to=2026-05-31')
      .set('Authorization', `Bearer ${makeToken('STUDENT')}`);

    expect(res.status).toBe(403);
  });

  test('returns 401 without Authorization header', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/heatmap?from=2026-05-01&to=2026-05-31');

    expect(res.status).toBe(401);
  });

  test('returns 400 when date params are missing', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/heatmap')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(400);
  });

  test('returns 400 when from > to', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/heatmap?from=2026-06-01&to=2026-05-01')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(400);
  });

  test('passes resourceId filter to service', async () => {
    const getHeatmapMock = jest.fn().mockResolvedValue({ from: '2026-05-01', to: '2026-05-31', cells: [] });
    const service = makeMockService({ getHeatmap: getHeatmapMock });
    const app = buildApp(service);

    await request(app)
      .get('/analytics/heatmap?from=2026-05-01&to=2026-05-31&resourceId=res-42')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(getHeatmapMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'res-42' }),
    );
  });
});

// ── GET /analytics/summary ────────────────────────────────────────────────────

describe('GET /analytics/summary', () => {
  test('returns summary for ADMIN', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/summary?from=2026-05-01&to=2026-05-31')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalApproved');
    expect(res.body).toHaveProperty('totalCancelled');
  });

  test('returns 403 for FACULTY role', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/summary?from=2026-05-01&to=2026-05-31')
      .set('Authorization', `Bearer ${makeToken('FACULTY')}`);

    expect(res.status).toBe(403);
  });

  test('returns 400 when date params are missing', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/summary')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(400);
  });
});

// ── GET /analytics/export.csv ─────────────────────────────────────────────────

describe('GET /analytics/export.csv', () => {
  test('returns CSV with correct content-type for ADMIN', async () => {
    const service = makeMockService({
      exportCsv: jest.fn().mockResolvedValue('id,eventType\nevt-1,BookingApproved\n'),
    });
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/export.csv?from=2026-05-01&to=2026-05-31')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('BookingApproved');
  });

  test('returns 403 for non-ADMIN', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/export.csv?from=2026-05-01&to=2026-05-31')
      .set('Authorization', `Bearer ${makeToken('STUDENT')}`);

    expect(res.status).toBe(403);
  });

  test('returns 400 when date params are missing', async () => {
    const service = makeMockService();
    const app = buildApp(service);

    const res = await request(app)
      .get('/analytics/export.csv')
      .set('Authorization', `Bearer ${makeToken('ADMIN')}`);

    expect(res.status).toBe(400);
  });
});
