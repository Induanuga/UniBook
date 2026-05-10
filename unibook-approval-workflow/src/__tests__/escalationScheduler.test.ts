// src/__tests__/escalationScheduler.test.ts
// Unit tests for the EscalationScheduler.

import { EscalationScheduler } from '../services/EscalationScheduler';
import type { ApprovalRequest } from '../types';

function makePendingApproval(): ApprovalRequest {
  return {
    id:             'appr-escalate-1',
    bookingId:      'book-1',
    resourceId:     'res-1',
    requesterId:    'user-1',
    requesterEmail: 'student@uni.edu',
    requesterRole:  'STUDENT',
    requesterName:  'Alice',
    department:     'CS',
    startTime:      new Date(Date.now() - 25 * 3600000), // 25 hours ago
    endTime:        new Date(Date.now() - 24 * 3600000),
    purpose:        'Research',
    status:         'AWAITING_FACULTY',
    currentLevel:   'FACULTY',
    createdAt:      new Date(Date.now() - 25 * 3600000),
    updatedAt:      new Date(Date.now() - 25 * 3600000),
  };
}

function makeMockService(overrides: {
  getPendingEscalations?: jest.Mock;
  escalateToAdmin?:       jest.Mock;
} = {}) {
  return {
    getPendingEscalations: overrides.getPendingEscalations ?? jest.fn().mockResolvedValue([]),
    escalateToAdmin:       overrides.escalateToAdmin       ?? jest.fn().mockResolvedValue(true),
  };
}

afterEach(() => jest.clearAllMocks());

describe('EscalationScheduler', () => {
  test('starts and stops without error', () => {
    const service   = makeMockService();
    const scheduler = new EscalationScheduler(service as never);

    expect(() => scheduler.start()).not.toThrow();
    expect(() => scheduler.stop()).not.toThrow();
  });

  test('does not escalate when no pending escalations found', async () => {
    const escalateToAdmin = jest.fn().mockResolvedValue(true);
    const service = makeMockService({
      getPendingEscalations: jest.fn().mockResolvedValue([]),
      escalateToAdmin,
    });

    const scheduler = new EscalationScheduler(service as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (scheduler as any).runCheck();

    expect(escalateToAdmin).not.toHaveBeenCalled();
  });

  test('calls escalateToAdmin for each overdue approval', async () => {
    const pending = [makePendingApproval(), { ...makePendingApproval(), id: 'appr-2' }];
    const escalateToAdmin = jest.fn().mockResolvedValue(true);

    const service = makeMockService({
      getPendingEscalations: jest.fn().mockResolvedValue(pending),
      escalateToAdmin,
    });

    const scheduler = new EscalationScheduler(service as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (scheduler as any).runCheck();

    expect(escalateToAdmin).toHaveBeenCalledTimes(2);
    expect(escalateToAdmin).toHaveBeenCalledWith('appr-escalate-1', expect.stringContaining('escalation'));
    expect(escalateToAdmin).toHaveBeenCalledWith('appr-2', expect.stringContaining('escalation'));
  });

  test('handles escalation failure gracefully (logs warn, continues)', async () => {
    const pending = [makePendingApproval()];
    const escalateToAdmin = jest.fn().mockResolvedValue(false); // Returns false = already decided

    const service = makeMockService({
      getPendingEscalations: jest.fn().mockResolvedValue(pending),
      escalateToAdmin,
    });

    const scheduler = new EscalationScheduler(service as never);
    // Should not throw even when escalate returns false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((scheduler as any).runCheck()).resolves.not.toThrow();
  });

  test('handles service error gracefully (catches exception)', async () => {
    const service = makeMockService({
      getPendingEscalations: jest.fn().mockRejectedValue(new Error('DB error')),
    });

    const scheduler = new EscalationScheduler(service as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((scheduler as any).runCheck()).resolves.not.toThrow();
  });

  test('does not start double interval if already running', () => {
    const service   = makeMockService();
    const scheduler = new EscalationScheduler(service as never);

    scheduler.start();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstId = (scheduler as any).intervalId;
    scheduler.start(); // Second start should be no-op
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const secondId = (scheduler as any).intervalId;

    expect(firstId).toBe(secondId);
    scheduler.stop();
  });
});
