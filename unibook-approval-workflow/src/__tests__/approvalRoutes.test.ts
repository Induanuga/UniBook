// src/__tests__/approvalRoutes.test.ts
// HTTP endpoint tests for the Approval Workflow REST API.
// Uses supertest with mocked ApprovalService — no DB needed.

import express from 'express';
import request from 'supertest';
import { createApprovalRouter } from '../routes/approvalRoutes';
import type { ApprovalRequest } from '../types';

// ── Mock JWT validation ──────────────────────────────────────────────────────
jest.mock('../middleware/validateToken', () => ({
  validateToken: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    // Default: authenticated as FACULTY
    req.user = {
      jti:        'jti-1',
      sub:        'faculty-1',
      email:      'faculty@uni.edu',
      name:       'Dr Smith',
      role:       'FACULTY',
      department: 'CS',
    };
    next();
  },
}));

jest.mock('../config', () => ({
  config: {
    jwt: { secret: 'test-secret' },
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSampleApproval(status = 'AWAITING_FACULTY'): ApprovalRequest {
  return {
    id:             'appr-1',
    bookingId:      'book-1',
    resourceId:     'res-1',
    requesterId:    'user-1',
    requesterEmail: 'student@uni.edu',
    requesterRole:  'STUDENT',
    requesterName:  'Alice',
    department:     'CS',
    startTime:      new Date(),
    endTime:        new Date(),
    purpose:        'Research',
    status:         status as ApprovalRequest['status'],
    currentLevel:   'FACULTY',
    createdAt:      new Date(),
    updatedAt:      new Date(),
  };
}

function makeApp(serviceOverrides: Partial<{
  getPendingForApprover: jest.Mock;
  getMyApprovals: jest.Mock;
  getApproval: jest.Mock;
  getApprovalByBookingId: jest.Mock;
  processDecision: jest.Mock;
  onBookingSubmitted: jest.Mock;
}>): express.Application {
  const mockService = {
    getPendingForApprover:    serviceOverrides.getPendingForApprover    ?? jest.fn().mockResolvedValue([]),
    getMyApprovals:           serviceOverrides.getMyApprovals           ?? jest.fn().mockResolvedValue([]),
    getApproval:              serviceOverrides.getApproval              ?? jest.fn().mockResolvedValue(makeSampleApproval()),
    getApprovalByBookingId:   serviceOverrides.getApprovalByBookingId   ?? jest.fn().mockResolvedValue(null),
    processDecision:          serviceOverrides.processDecision          ?? jest.fn().mockResolvedValue({ approval: makeSampleApproval('APPROVED'), message: 'Booking approved successfully.' }),
    onBookingSubmitted:       serviceOverrides.onBookingSubmitted       ?? jest.fn().mockResolvedValue(undefined),
    escalateToAdmin:          jest.fn().mockResolvedValue(true),
    getPendingEscalations:    jest.fn().mockResolvedValue([]),
    getAllPendingAtLevel:      jest.fn().mockResolvedValue([]),
    getApprovalStatus:        jest.fn().mockResolvedValue(null),
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.correlationId = 'corr-test'; next(); });
  app.use('/approvals', createApprovalRouter(mockService as never));
  return app;
}

afterEach(() => jest.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /approvals/pending', () => {
  test('returns 200 with empty list when no pending approvals', async () => {
    const app = makeApp({});
    const res = await request(app).get('/approvals/pending');
    expect(res.status).toBe(200);
    expect(res.body.approvals).toEqual([]);
  });

  test('returns 200 with pending approvals list', async () => {
    const app = makeApp({
      getPendingForApprover: jest.fn().mockResolvedValue([makeSampleApproval()]),
    });
    const res = await request(app).get('/approvals/pending');
    expect(res.status).toBe(200);
    expect(res.body.approvals).toHaveLength(1);
  });
});

describe('GET /approvals/my', () => {
  test('returns 200 with list of my approvals', async () => {
    const app = makeApp({
      getMyApprovals: jest.fn().mockResolvedValue([makeSampleApproval()]),
    });
    const res = await request(app).get('/approvals/my');
    expect(res.status).toBe(200);
    expect(res.body.approvals).toHaveLength(1);
  });
});

describe('GET /approvals/booking/:bookingId', () => {
  test('returns 404 when no approval found for booking', async () => {
    const app = makeApp({ getApprovalByBookingId: jest.fn().mockResolvedValue(null) });
    const res = await request(app).get('/approvals/booking/book-999');
    expect(res.status).toBe(404);
  });

  test('returns 200 with approval when found (faculty checking own pending)', async () => {
    // faculty-1 is checking: approval.requesterId !== faculty-1 BUT role is FACULTY → allowed
    const app = makeApp({
      getApprovalByBookingId: jest.fn().mockResolvedValue(makeSampleApproval()),
    });
    const res = await request(app).get('/approvals/booking/book-1');
    expect(res.status).toBe(200);
    expect(res.body.approval.id).toBe('appr-1');
  });
});

describe('GET /approvals/:id', () => {
  test('returns 200 with approval details', async () => {
    const app = makeApp({
      getApproval: jest.fn().mockResolvedValue(makeSampleApproval()),
    });
    const res = await request(app).get('/approvals/appr-1');
    expect(res.status).toBe(200);
    expect(res.body.approval.id).toBe('appr-1');
  });

  test('returns 404 when approval not found', async () => {
    const app = makeApp({ getApproval: jest.fn().mockResolvedValue(null) });
    const res = await request(app).get('/approvals/non-existent');
    expect(res.status).toBe(404);
  });
});

describe('POST /approvals/:id/decide', () => {
  test('returns 200 on valid APPROVE decision', async () => {
    const app = makeApp({
      processDecision: jest.fn().mockResolvedValue({
        approval: makeSampleApproval('APPROVED'),
        message:  'Booking approved successfully.',
      }),
    });
    const res = await request(app)
      .post('/approvals/appr-1/decide')
      .send({ decision: 'APPROVE', reason: 'Good request' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('approved');
  });

  test('returns 200 on valid REJECT decision', async () => {
    const app = makeApp({
      processDecision: jest.fn().mockResolvedValue({
        approval: makeSampleApproval('REJECTED'),
        message:  'Booking rejected.',
      }),
    });
    const res = await request(app)
      .post('/approvals/appr-1/decide')
      .send({ decision: 'REJECT', reason: 'Resource unavailable' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('rejected');
  });

  test('returns 400 for invalid decision value', async () => {
    const app = makeApp({});
    const res = await request(app)
      .post('/approvals/appr-1/decide')
      .send({ decision: 'INVALID_ACTION' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 when decision field missing', async () => {
    const app = makeApp({});
    const res = await request(app)
      .post('/approvals/appr-1/decide')
      .send({});

    expect(res.status).toBe(400);
  });

  test('returns 409 when approval already decided', async () => {
    const err = Object.assign(new Error('Already decided'), { code: 'ALREADY_DECIDED' });
    const app = makeApp({ processDecision: jest.fn().mockRejectedValue(err) });

    const res = await request(app)
      .post('/approvals/appr-1/decide')
      .send({ decision: 'APPROVE' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_DECIDED');
  });

  test('returns 403 when approver is not assigned', async () => {
    const err = Object.assign(new Error('Not assigned'), { code: 'NOT_ASSIGNED' });
    const app = makeApp({ processDecision: jest.fn().mockRejectedValue(err) });

    const res = await request(app)
      .post('/approvals/appr-1/decide')
      .send({ decision: 'APPROVE' });

    expect(res.status).toBe(403);
  });
});

describe('POST /approvals/internal/booking-submitted', () => {
  test('returns 401 with wrong service key', async () => {
    const app = makeApp({});
    const res = await request(app)
      .post('/approvals/internal/booking-submitted')
      .set('X-Service-Key', 'wrong-key')
      .send({ bookingId: 'b1', userId: 'u1', userRole: 'STUDENT' });

    expect(res.status).toBe(401);
  });

  test('returns 202 with correct service key', async () => {
    const app = makeApp({});
    const res = await request(app)
      .post('/approvals/internal/booking-submitted')
      .set('X-Service-Key', 'test-secret')
      .send({
        eventType: 'BookingSubmitted',
        bookingId: 'b1', userId: 'u1', userRole: 'STUDENT',
        userEmail: 'u@uni.edu', resourceId: 'r1', department: 'CS',
        startTime: new Date().toISOString(), endTime: new Date().toISOString(),
        purpose: 'Test', timestamp: new Date().toISOString(), correlationId: 'c1',
      });

    expect(res.status).toBe(202);
  });

  test('returns 400 when required fields missing', async () => {
    const app = makeApp({});
    const res = await request(app)
      .post('/approvals/internal/booking-submitted')
      .set('X-Service-Key', 'test-secret')
      .send({ bookingId: 'b1' }); // missing userId and userRole

    expect(res.status).toBe(400);
  });
});
