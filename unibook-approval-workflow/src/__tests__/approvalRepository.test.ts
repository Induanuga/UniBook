// src/__tests__/approvalRepository.test.ts
// Unit tests for ApprovalRepository — all DB interactions mocked.

import { ApprovalRepository } from '../repositories/ApprovalRepository';
import type { ApprovalStatus } from '../types';

function makePool(rows: object[] = []) {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  };
}

const SAMPLE_APPROVAL_ROW = {
  id:               'appr-1',
  booking_id:       'book-1',
  resource_id:      'res-1',
  requester_id:     'user-1',
  requester_email:  'student@uni.edu',
  requester_role:   'STUDENT',
  requester_name:   'Alice',
  department:       'CS',
  start_time:       new Date(Date.now() + 3600000).toISOString(),
  end_time:         new Date(Date.now() + 7200000).toISOString(),
  purpose:          'Research',
  resource_name:    'Lab A',
  status:           'AWAITING_FACULTY',
  current_level:    'FACULTY',
  decided_by_id:    null,
  decided_by_email: null,
  decision_reason:  null,
  alternative_slot: null,
  escalated_at:     null,
  decided_at:       null,
  created_at:       new Date().toISOString(),
  updated_at:       new Date().toISOString(),
};

const SAMPLE_ASSIGNMENT_ROW = {
  id:             'assign-1',
  approval_id:    'appr-1',
  approver_id:    'faculty-1',
  approver_email: 'faculty@uni.edu',
  approver_role:  'FACULTY',
  assigned_at:    new Date().toISOString(),
  is_active:      true,
  decided_at:     null,
  decision:       null,
};

afterEach(() => jest.clearAllMocks());

describe('ApprovalRepository.createApprovalRequest()', () => {
  test('inserts and returns mapped ApprovalRequest', async () => {
    const pool = makePool([SAMPLE_APPROVAL_ROW]);
    const repo = new ApprovalRepository(pool as never);

    const result = await repo.createApprovalRequest({
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
      initialStatus:  'AWAITING_FACULTY',
      currentLevel:   'FACULTY',
    });

    expect(result.id).toBe('appr-1');
    expect(result.status).toBe('AWAITING_FACULTY');
    expect(result.currentLevel).toBe('FACULTY');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('ApprovalRepository.findById()', () => {
  test('returns approval when found', async () => {
    const pool = makePool([SAMPLE_APPROVAL_ROW]);
    const repo = new ApprovalRepository(pool as never);
    const result = await repo.findById('appr-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('appr-1');
  });

  test('returns null when not found', async () => {
    const pool = makePool([]);
    const repo = new ApprovalRepository(pool as never);
    const result = await repo.findById('non-existent');
    expect(result).toBeNull();
  });
});

describe('ApprovalRepository.findByBookingId()', () => {
  test('returns approval when found', async () => {
    const pool = makePool([SAMPLE_APPROVAL_ROW]);
    const repo = new ApprovalRepository(pool as never);
    const result = await repo.findByBookingId('book-1');
    expect(result!.bookingId).toBe('book-1');
  });

  test('returns null when not found', async () => {
    const pool = makePool([]);
    const repo = new ApprovalRepository(pool as never);
    const result = await repo.findByBookingId('book-missing');
    expect(result).toBeNull();
  });
});

describe('ApprovalRepository.findPendingByLevel()', () => {
  test('returns AWAITING_FACULTY approvals for FACULTY level', async () => {
    const pool = makePool([SAMPLE_APPROVAL_ROW]);
    const repo = new ApprovalRepository(pool as never);
    const results = await repo.findPendingByLevel('FACULTY');
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('AWAITING_FACULTY');
  });

  test('returns empty array when none pending', async () => {
    const pool = makePool([]);
    const repo = new ApprovalRepository(pool as never);
    const results = await repo.findPendingByLevel('ADMIN');
    expect(results).toHaveLength(0);
  });
});

describe('ApprovalRepository.findPendingForApprover()', () => {
  test('returns approvals where the approver is active', async () => {
    const pool = makePool([SAMPLE_APPROVAL_ROW]);
    const repo = new ApprovalRepository(pool as never);
    const results = await repo.findPendingForApprover('faculty-1');
    expect(results).toHaveLength(1);
  });
});

describe('ApprovalRepository.isAssignedApprover()', () => {
  test('returns true when approver is active', async () => {
    const pool = makePool([{ '?column?': 1 }]);
    const repo = new ApprovalRepository(pool as never);
    const result = await repo.isAssignedApprover('appr-1', 'faculty-1');
    expect(result).toBe(true);
  });

  test('returns false when approver is not active', async () => {
    const pool = makePool([]);
    const repo = new ApprovalRepository(pool as never);
    const result = await repo.isAssignedApprover('appr-1', 'faculty-999');
    expect(result).toBe(false);
  });
});

describe('ApprovalRepository.recordDecision()', () => {
  test('records APPROVE decision and returns updated approval', async () => {
    const approvedRow = { ...SAMPLE_APPROVAL_ROW, status: 'APPROVED', decided_by_email: 'faculty@uni.edu' };
    const queryMock = jest.fn()
      .mockResolvedValueOnce({ rows: [approvedRow] })   // UPDATE approval_requests
      .mockResolvedValueOnce({ rows: [] });             // UPDATE approver_assignments

    const pool = { query: queryMock };
    const repo = new ApprovalRepository(pool as never);

    const result = await repo.recordDecision({
      approvalId:    'appr-1',
      approverId:    'faculty-1',
      approverEmail: 'faculty@uni.edu',
      decision:      'APPROVE',
      reason:        'Looks good',
    });

    expect(result).not.toBeNull();
    expect(result!.status).toBe('APPROVED');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  test('returns null when approval not found', async () => {
    const queryMock = jest.fn().mockResolvedValueOnce({ rows: [] });
    const pool = { query: queryMock };
    const repo = new ApprovalRepository(pool as never);

    const result = await repo.recordDecision({
      approvalId:    'non-existent',
      approverId:    'faculty-1',
      approverEmail: 'faculty@uni.edu',
      decision:      'REJECT',
    });

    expect(result).toBeNull();
  });
});

describe('ApprovalRepository.escalate()', () => {
  test('transitions AWAITING_FACULTY to AWAITING_ADMIN', async () => {
    const escalatedRow = {
      ...SAMPLE_APPROVAL_ROW,
      status:       'AWAITING_ADMIN',
      current_level: 'ADMIN',
      escalated_at:  new Date().toISOString(),
    };
    const queryMock = jest.fn()
      .mockResolvedValueOnce({ rows: [] })          // Deactivate faculty assignments
      .mockResolvedValueOnce({ rows: [escalatedRow] }); // Update to AWAITING_ADMIN

    const pool = { query: queryMock };
    const repo = new ApprovalRepository(pool as never);

    const result = await repo.escalate('appr-1');

    expect(result).not.toBeNull();
    expect(result!.status).toBe('AWAITING_ADMIN');
    expect(result!.currentLevel).toBe('ADMIN');
  });

  test('returns null if approval is already decided', async () => {
    const queryMock = jest.fn()
      .mockResolvedValueOnce({ rows: [] })   // Deactivate assignments
      .mockResolvedValueOnce({ rows: [] });  // No rows updated (already decided)

    const pool = { query: queryMock };
    const repo = new ApprovalRepository(pool as never);

    const result = await repo.escalate('already-decided');
    expect(result).toBeNull();
  });
});

describe('ApprovalRepository.createAssignments()', () => {
  test('creates assignments for all provided approvers', async () => {
    const pool = makePool([SAMPLE_ASSIGNMENT_ROW]);
    const repo = new ApprovalRepository(pool as never);

    const assignments = await repo.createAssignments({
      approvalId: 'appr-1',
      approvers: [
        { id: 'f1', email: 'f1@uni.edu', role: 'FACULTY' },
        { id: 'f2', email: 'f2@uni.edu', role: 'FACULTY' },
      ],
    });

    expect(assignments).toHaveLength(2);
    // Two INSERT queries — one per approver
    expect((pool as { query: jest.Mock }).query).toHaveBeenCalledTimes(2);
  });

  test('returns empty array when no approvers provided', async () => {
    const pool = makePool([]);
    const repo = new ApprovalRepository(pool as never);

    const assignments = await repo.createAssignments({ approvalId: 'appr-1', approvers: [] });
    expect(assignments).toHaveLength(0);
    expect((pool as { query: jest.Mock }).query).not.toHaveBeenCalled();
  });
});

describe('ApprovalRepository.findPendingEscalation()', () => {
  test('queries with correct interval for given escalation hours', async () => {
    const pool = makePool([SAMPLE_APPROVAL_ROW]);
    const repo = new ApprovalRepository(pool as never);

    await repo.findPendingEscalation(24);

    const { query } = pool as { query: jest.Mock };
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('AWAITING_FACULTY'),
      [24],
    );
  });
});
