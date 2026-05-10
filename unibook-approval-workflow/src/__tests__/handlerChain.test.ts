// src/__tests__/handlerChain.test.ts
// Unit tests for the Chain of Responsibility — handler routing logic.

import { ApprovalHandlerChain } from '../handlers/ApprovalHandlerChain';
import type { HandlerContext } from '../handlers/IApprovalHandler';

function makeMockRepo() {
  return {
    createApprovalRequest: jest.fn().mockResolvedValue({
      id:          'appr-1',
      bookingId:   'book-1',
      status:      'AWAITING_FACULTY',
      currentLevel: 'FACULTY',
    }),
    createAssignments: jest.fn().mockResolvedValue([]),
    isAssignedApprover: jest.fn().mockResolvedValue(true),
    findPendingForApprover: jest.fn().mockResolvedValue([]),
    findByBookingId: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    recordDecision: jest.fn().mockResolvedValue(null),
    escalate: jest.fn().mockResolvedValue(null),
    findPendingByLevel: jest.fn().mockResolvedValue([]),
    findByRequesterId: jest.fn().mockResolvedValue([]),
    findPendingEscalation: jest.fn().mockResolvedValue([]),
    findActiveAssignments: jest.fn().mockResolvedValue([]),
  };
}

function makeContext(role: string): HandlerContext {
  return {
    bookingId:      'book-1',
    resourceId:     'res-1',
    requesterId:    'user-1',
    requesterEmail: 'user@uni.edu',
    requesterRole:  role,
    requesterName:  'Test User',
    department:     'CS',
    startTime:      new Date(),
    endTime:        new Date(),
    purpose:        'Testing',
    correlationId:  'corr-1',
  };
}

// Mock axios to prevent real HTTP calls
jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({ data: { users: [] } }),
}));

afterEach(() => jest.clearAllMocks());

describe('ApprovalHandlerChain — STUDENT bookings', () => {
  test('routes STUDENT booking to FacultyApprovalHandler (handled=true, level=FACULTY)', async () => {
    const mockRepo = makeMockRepo();
    const chain    = ApprovalHandlerChain.buildDefault(mockRepo as never);

    const result = await chain.handle(makeContext('STUDENT'));

    expect(result.handled).toBe(true);
    expect(result.level).toBe('FACULTY');
    expect(mockRepo.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ currentLevel: 'FACULTY', initialStatus: 'AWAITING_FACULTY' }),
    );
  });
});

describe('ApprovalHandlerChain — FACULTY bookings', () => {
  test('routes FACULTY booking to AdminApprovalHandler (handled=true, level=ADMIN)', async () => {
    const mockRepo = makeMockRepo();
    mockRepo.createApprovalRequest.mockResolvedValue({
      id: 'appr-2', bookingId: 'book-2', status: 'AWAITING_ADMIN', currentLevel: 'ADMIN',
    });

    const chain = ApprovalHandlerChain.buildDefault(mockRepo as never);
    const result = await chain.handle(makeContext('FACULTY'));

    expect(result.handled).toBe(true);
    expect(result.level).toBe('ADMIN');
    expect(mockRepo.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ currentLevel: 'ADMIN', initialStatus: 'AWAITING_ADMIN' }),
    );
  });
});

describe('ApprovalHandlerChain — IT_STAFF bookings', () => {
  test('routes IT_STAFF booking to AdminApprovalHandler', async () => {
    const mockRepo = makeMockRepo();
    mockRepo.createApprovalRequest.mockResolvedValue({
      id: 'appr-3', bookingId: 'book-3', status: 'AWAITING_ADMIN', currentLevel: 'ADMIN',
    });

    const chain = ApprovalHandlerChain.buildDefault(mockRepo as never);
    const result = await chain.handle(makeContext('IT_STAFF'));

    expect(result.handled).toBe(true);
    expect(result.level).toBe('ADMIN');
  });
});

describe('ApprovalHandlerChain — unhandled role', () => {
  test('routes ADMIN booking to EscalationHandler (handled=false)', async () => {
    const mockRepo = makeMockRepo();
    const chain    = ApprovalHandlerChain.buildDefault(mockRepo as never);

    // ADMIN bookings: no handler configured → falls through to EscalationHandler
    const result = await chain.handle(makeContext('ADMIN'));

    // EscalationHandler returns handled=false for unconfigured roles
    expect(result.handled).toBe(false);
    expect(result.message).toContain('ADMIN');
  });
});

describe('ApprovalHandlerChain — broadcast model', () => {
  test('calls createAssignments with fetched approvers for STUDENT booking', async () => {
    const mockRepo = makeMockRepo();
    const axios    = require('axios');
    axios.get.mockResolvedValue({ data: { users: [
      { id: 'f1', email: 'f1@uni.edu' },
      { id: 'f2', email: 'f2@uni.edu' },
    ]}});

    const chain = ApprovalHandlerChain.buildDefault(mockRepo as never);
    await chain.handle(makeContext('STUDENT'));

    expect(mockRepo.createAssignments).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      approvers: [
        { id: 'f1', email: 'f1@uni.edu', role: 'FACULTY' },
        { id: 'f2', email: 'f2@uni.edu', role: 'FACULTY' },
      ],
    });
  });

  test('still creates approval even when IAM returns no faculty (graceful degradation)', async () => {
    const mockRepo = makeMockRepo();
    const axios    = require('axios');
    axios.get.mockResolvedValue({ data: { users: [] } });

    const chain  = ApprovalHandlerChain.buildDefault(mockRepo as never);
    const result = await chain.handle(makeContext('STUDENT'));

    expect(result.handled).toBe(true);
    expect(mockRepo.createAssignments).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      approvers: [],
    });
  });
});
