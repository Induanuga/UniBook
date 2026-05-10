// src/__tests__/approvalService.test.ts
// Unit tests for ApprovalService — all dependencies mocked.

import { ApprovalService } from '../services/ApprovalService';
import type { BookingSubmittedEvent, ApprovalRequest } from '../types';

// Mock axios globally — prevents any real HTTP calls.
jest.mock('axios', () => ({
  get:   jest.fn().mockResolvedValue({ data: {} }),
  post:  jest.fn().mockResolvedValue({ data: {} }),
  patch: jest.fn().mockResolvedValue({ data: {} }),
}));

// Use fake timers so setImmediate (fire-and-forget notification/analytics calls)
// never actually fires during tests — eliminates all "Cannot log after tests are done" warnings.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runAllTimers();   // flush any pending timers cleanly
  jest.useRealTimers();
  jest.clearAllMocks();
});

function makeMockRepo(overrides: Partial<{
  findByBookingId: jest.Mock;
  createApprovalRequest: jest.Mock;
  findById: jest.Mock;
  isAssignedApprover: jest.Mock;
  recordDecision: jest.Mock;
  findPendingForApprover: jest.Mock;
  findByRequesterId: jest.Mock;
  findPendingByLevel: jest.Mock;
  createAssignments: jest.Mock;
  escalate: jest.Mock;
  findPendingEscalation: jest.Mock;
}> = {}): Record<string, jest.Mock> {
  return {
    findByBookingId:     overrides.findByBookingId     ?? jest.fn().mockResolvedValue(null),
    createApprovalRequest: overrides.createApprovalRequest ?? jest.fn().mockResolvedValue(makeSampleApproval()),
    findById:            overrides.findById            ?? jest.fn().mockResolvedValue(makeSampleApproval()),
    isAssignedApprover:  overrides.isAssignedApprover  ?? jest.fn().mockResolvedValue(true),
    recordDecision:      overrides.recordDecision      ?? jest.fn().mockResolvedValue(makeSampleApproval('APPROVED')),
    findPendingForApprover: overrides.findPendingForApprover ?? jest.fn().mockResolvedValue([]),
    findByRequesterId:   overrides.findByRequesterId   ?? jest.fn().mockResolvedValue([]),
    findPendingByLevel:  overrides.findPendingByLevel  ?? jest.fn().mockResolvedValue([]),
    createAssignments:   overrides.createAssignments   ?? jest.fn().mockResolvedValue([]),
    escalate:            overrides.escalate            ?? jest.fn().mockResolvedValue(makeSampleApproval('AWAITING_ADMIN')),
    findPendingEscalation: overrides.findPendingEscalation ?? jest.fn().mockResolvedValue([]),
  };
}

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

function makeBookingEvent(userRole = 'STUDENT'): BookingSubmittedEvent {
  return {
    eventType:      'BookingSubmitted',
    correlationId:  'corr-1',
    bookingId:      'book-1',
    resourceId:     'res-1',
    userId:         'user-1',
    userEmail:      'student@uni.edu',
    userName:       'Alice',
    userRole,
    department:     'CS',
    startTime:      new Date(Date.now() + 3600000).toISOString(),
    endTime:        new Date(Date.now() + 7200000).toISOString(),
    purpose:        'Research',
    timestamp:      new Date().toISOString(),
  };
}

function makePool() {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  const pool = {
    connect: jest.fn().mockResolvedValue({
      query:   mockQuery,
      release: jest.fn(),
    }),
    query: mockQuery,
  };
  return pool;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ApprovalService.onBookingSubmitted()', () => {
  test('creates approval request for student booking', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    // Inject mock repo
    const mockRepo = makeMockRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chainHandleMock = jest.fn().mockResolvedValue({ handled: true, approvalId: 'appr-1', level: 'FACULTY' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).chain = { handle: chainHandleMock, getAdminHandler: jest.fn() };

    await service.onBookingSubmitted(makeBookingEvent('STUDENT'));

    expect(chainHandleMock).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'book-1', requesterRole: 'STUDENT' }),
    );
  });

  test('skips duplicate bookings (idempotency)', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const mockRepo = makeMockRepo({
      findByBookingId: jest.fn().mockResolvedValue(makeSampleApproval()),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;
    const chainHandleMock = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).chain = { handle: chainHandleMock };

    await service.onBookingSubmitted(makeBookingEvent('STUDENT'));

    expect(chainHandleMock).not.toHaveBeenCalled();
  });
});

describe('ApprovalService.processDecision()', () => {
  test('processes APPROVE decision for assigned approver', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const approvedApproval = makeSampleApproval('APPROVED');
    const mockRepo = makeMockRepo({
      recordDecision: jest.fn().mockResolvedValue(approvedApproval),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).notifyBookingEngine = jest.fn().mockResolvedValue(undefined);

    const result = await service.processDecision(
      'appr-1', 'faculty-1', 'faculty@uni.edu',
      { decision: 'APPROVE', reason: 'Looks good' },
    );

    expect(result.approval.status).toBe('APPROVED');
    expect(result.message).toContain('approved');
  });

  test('throws NOT_FOUND when approval does not exist', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const mockRepo = makeMockRepo({ findById: jest.fn().mockResolvedValue(null) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;

    await expect(
      service.processDecision('non-existent', 'f1', 'f@uni.edu', { decision: 'APPROVE' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('throws ALREADY_DECIDED when approval is not pending', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const decided = makeSampleApproval('APPROVED');
    const mockRepo = makeMockRepo({ findById: jest.fn().mockResolvedValue(decided) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;

    await expect(
      service.processDecision('appr-1', 'f1', 'f@uni.edu', { decision: 'REJECT' }),
    ).rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });

  test('throws NOT_ASSIGNED when approver is not in assignments', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const mockRepo = makeMockRepo({
      isAssignedApprover: jest.fn().mockResolvedValue(false),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;

    await expect(
      service.processDecision('appr-1', 'wrong-user', 'wrong@uni.edu', { decision: 'APPROVE' }),
    ).rejects.toMatchObject({ code: 'NOT_ASSIGNED' });
  });

  test('throws VALIDATION_ERROR for SUGGEST_ALTERNATIVE without slots', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const mockRepo = makeMockRepo();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;

    await expect(
      service.processDecision('appr-1', 'faculty-1', 'f@uni.edu', {
        decision: 'SUGGEST_ALTERNATIVE',
        // Missing alternativeStart / alternativeEnd
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('processes REJECT decision', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const rejectedApproval = makeSampleApproval('REJECTED');
    const mockRepo = makeMockRepo({
      recordDecision: jest.fn().mockResolvedValue(rejectedApproval),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).notifyBookingEngine = jest.fn();

    const result = await service.processDecision(
      'appr-1', 'faculty-1', 'faculty@uni.edu',
      { decision: 'REJECT', reason: 'Lab unavailable' },
    );

    expect(result.approval.status).toBe('REJECTED');
  });

  test('processes SUGGEST_ALTERNATIVE decision with valid slots', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const altApproval = makeSampleApproval('ALTERNATIVE_SUGGESTED');
    const mockRepo = makeMockRepo({
      recordDecision: jest.fn().mockResolvedValue(altApproval),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).notifyBookingEngine = jest.fn();

    const result = await service.processDecision(
      'appr-1', 'faculty-1', 'faculty@uni.edu',
      {
        decision:         'SUGGEST_ALTERNATIVE',
        alternativeStart: new Date(Date.now() + 86400000).toISOString(),
        alternativeEnd:   new Date(Date.now() + 90000000).toISOString(),
      },
    );

    expect(result.approval.status).toBe('ALTERNATIVE_SUGGESTED');
  });
});

describe('ApprovalService.escalateToAdmin()', () => {
  test('escalates pending faculty approval to admin', async () => {
    const client = {
      query:   jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const pool = {
      connect: jest.fn().mockResolvedValue(client),
      query:   jest.fn().mockResolvedValue({ rows: [] }),
    };
    const service = new ApprovalService(pool as never, pool as never);

    const mockRepo = makeMockRepo({
      escalate: jest.fn().mockResolvedValue(makeSampleApproval('AWAITING_ADMIN')),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;
    const adminHandlerMock = {
      assignAdminsToExistingApproval: jest.fn().mockResolvedValue(3),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).chain = { getAdminHandler: () => adminHandlerMock };

    const success = await service.escalateToAdmin('appr-1', 'corr-1');
    expect(success).toBe(true);
    expect(mockRepo.escalate).toHaveBeenCalledWith('appr-1', client);
    expect(adminHandlerMock.assignAdminsToExistingApproval).toHaveBeenCalledWith('appr-1', 'corr-1');
  });

  test('returns false when escalation target not found (already decided)', async () => {
    const client = {
      query:   jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) };
    const service = new ApprovalService(pool as never, pool as never);

    const mockRepo = makeMockRepo({
      escalate: jest.fn().mockResolvedValue(null),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;

    const success = await service.escalateToAdmin('appr-1');
    expect(success).toBe(false);
  });
});

describe('ApprovalService.getPendingForApprover()', () => {
  test('returns list of pending approvals for approver', async () => {
    const pool    = makePool();
    const service = new ApprovalService(pool as never, pool as never);

    const mockRepo = makeMockRepo({
      findPendingForApprover: jest.fn().mockResolvedValue([makeSampleApproval(), makeSampleApproval()]),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).repo = mockRepo;

    const approvals = await service.getPendingForApprover('faculty-1');
    expect(approvals).toHaveLength(2);
  });
});
