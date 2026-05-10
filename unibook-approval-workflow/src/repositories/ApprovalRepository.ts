// src/repositories/ApprovalRepository.ts
// Repository pattern — encapsulates all PostgreSQL access for approval tables.
// Subsystem 4 owns: approval_requests, approver_assignments.

import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type {
  ApprovalRequest,
  ApprovalStatus,
  ApproverAssignment,
  DecisionType,
} from '../types';
import { logger } from '../utils/logger';

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToApprovalRequest(row: Record<string, unknown>): ApprovalRequest {
  return {
    id:               row.id as string,
    bookingId:        row.booking_id as string,
    resourceId:       row.resource_id as string,
    requesterId:      row.requester_id as string,
    requesterEmail:   row.requester_email as string,
    requesterRole:    row.requester_role as ApprovalRequest['requesterRole'],
    requesterName:    (row.requester_name as string) || '',
    department:       row.department as string,
    startTime:        new Date(row.start_time as string),
    endTime:          new Date(row.end_time as string),
    purpose:          row.purpose as string,
    resourceName:     row.resource_name as string | undefined,
    status:           row.status as ApprovalStatus,
    currentLevel:     row.current_level as ApprovalRequest['currentLevel'],
    decidedById:      row.decided_by_id as string | undefined,
    decidedByEmail:   row.decided_by_email as string | undefined,
    decisionReason:   row.decision_reason as string | undefined,
    alternativeSlot:  row.alternative_slot ? (row.alternative_slot as any) : undefined,
    escalatedAt:      row.escalated_at ? new Date(row.escalated_at as string) : undefined,
    decidedAt:        row.decided_at ? new Date(row.decided_at as string) : undefined,
    createdAt:        new Date(row.created_at as string),
    updatedAt:        new Date(row.updated_at as string),
  };
}

function rowToAssignment(row: Record<string, unknown>): ApproverAssignment {
  return {
    id:            row.id as string,
    approvalId:    row.approval_id as string,
    approverId:    row.approver_id as string,
    approverEmail: row.approver_email as string,
    approverRole:  row.approver_role as ApproverAssignment['approverRole'],
    assignedAt:    new Date(row.assigned_at as string),
    isActive:      row.is_active as boolean,
    decidedAt:     row.decided_at ? new Date(row.decided_at as string) : undefined,
    decision:      row.decision as DecisionType | undefined,
  };
}

// ── Repository ───────────────────────────────────────────────────────────────

export class ApprovalRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Create a new approval request when a booking is submitted.
   * Called by ApprovalRouter on BookingSubmitted event.
   */
  async createApprovalRequest(params: {
    bookingId:      string;
    resourceId:     string;
    requesterId:    string;
    requesterEmail: string;
    requesterRole:  ApprovalRequest['requesterRole'];
    requesterName:  string;
    department:     string;
    startTime:      Date;
    endTime:        Date;
    purpose:        string;
    resourceName?:  string;
    initialStatus:  ApprovalStatus;
    currentLevel:   'FACULTY' | 'ADMIN';
  }, client?: PoolClient): Promise<ApprovalRequest> {
    const executor = client ?? this.db;
    const id = uuidv4();

    const result = await executor.query(
      `INSERT INTO approval_requests
         (id, booking_id, resource_id, requester_id, requester_email, requester_role,
          requester_name, department, start_time, end_time, purpose, resource_name,
          status, current_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        id,
        params.bookingId,
        params.resourceId,
        params.requesterId,
        params.requesterEmail,
        params.requesterRole,
        params.requesterName,
        params.department,
        params.startTime.toISOString(),
        params.endTime.toISOString(),
        params.purpose,
        params.resourceName ?? null,
        params.initialStatus,
        params.currentLevel,
      ],
    );

    return rowToApprovalRequest(result.rows[0]);
  }

  /** Find by approval ID */
  async findById(id: string): Promise<ApprovalRequest | null> {
    const result = await this.db.query(
      'SELECT * FROM approval_requests WHERE id = $1',
      [id],
    );
    return result.rows.length ? rowToApprovalRequest(result.rows[0]) : null;
  }

  /** Find by booking ID */
  async findByBookingId(bookingId: string): Promise<ApprovalRequest | null> {
    const result = await this.db.query(
      'SELECT * FROM approval_requests WHERE booking_id = $1',
      [bookingId],
    );
    return result.rows.length ? rowToApprovalRequest(result.rows[0]) : null;
  }

  /** Get all pending requests at a given level — for approvers to see */
  async findPendingByLevel(level: 'FACULTY' | 'ADMIN'): Promise<ApprovalRequest[]> {
    const statusMap: Record<string, ApprovalStatus> = {
      FACULTY: 'AWAITING_FACULTY',
      ADMIN:   'AWAITING_ADMIN',
    };
    const result = await this.db.query(
      `SELECT * FROM approval_requests
       WHERE status = $1
       ORDER BY created_at ASC`,
      [statusMap[level]],
    );
    return result.rows.map(rowToApprovalRequest);
  }

  /**
   * Get pending requests where the given user is an active approver.
   * (i.e. they haven't decided yet and they are assigned)
   */
  async findPendingForApprover(approverId: string): Promise<ApprovalRequest[]> {
    const result = await this.db.query(
      `SELECT ar.* FROM approval_requests ar
       INNER JOIN approver_assignments aa ON aa.approval_id = ar.id
       WHERE aa.approver_id = $1
         AND aa.is_active = TRUE
         AND ar.status IN ('AWAITING_FACULTY','AWAITING_ADMIN')
       ORDER BY ar.created_at ASC`,
      [approverId],
    );
    return result.rows.map(rowToApprovalRequest);
  }

  /** Get all approvals (any status) for a requester */
  async findByRequesterId(requesterId: string): Promise<ApprovalRequest[]> {
    const result = await this.db.query(
      `SELECT * FROM approval_requests
       WHERE requester_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [requesterId],
    );
    return result.rows.map(rowToApprovalRequest);
  }

  /**
   * Record a decision (APPROVE / REJECT / SUGGEST_ALTERNATIVE).
   * Marks the deciding approver as decided, and deactivates all others.
   * Returns the updated ApprovalRequest.
   */
  async recordDecision(params: {
    approvalId:     string;
    approverId:     string;
    approverEmail:  string;
    decision:       DecisionType;
    reason?:        string;
    alternativeSlot?: { startTime: string; endTime: string };
  }, client?: PoolClient): Promise<ApprovalRequest | null> {
    const executor = client ?? this.db;

    const newStatus: ApprovalStatus =
      params.decision === 'APPROVE'            ? 'APPROVED' :
      params.decision === 'REJECT'             ? 'REJECTED' :
      'ALTERNATIVE_SUGGESTED';

    // Update approval request
    const result = await executor.query(
      `UPDATE approval_requests
       SET status           = $1,
           decided_by_id    = $2,
           decided_by_email = $3,
           decision_reason  = $4,
           alternative_slot = $5,
           decided_at       = NOW(),
           updated_at       = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        newStatus,
        params.approverId,
        params.approverEmail,
        params.reason ?? null,
        params.alternativeSlot ? JSON.stringify(params.alternativeSlot) : null,
        params.approvalId,
      ],
    );

    if (!result.rows.length) return null;

    // Deactivate all assignments for this approval (broadcast cleanup)
    await executor.query(
      `UPDATE approver_assignments
       SET is_active = FALSE,
           decided_at = CASE WHEN approver_id = $1 THEN NOW() ELSE decided_at END,
           decision   = CASE WHEN approver_id = $1 THEN $2    ELSE decision   END
       WHERE approval_id = $3`,
      [params.approverId, params.decision, params.approvalId],
    );

    logger.info({
      component:  'ApprovalRepository',
      action:     'DECISION_RECORDED',
      approvalId: params.approvalId,
      decision:   params.decision,
      decidedBy:  params.approverEmail,
    });

    return rowToApprovalRequest(result.rows[0]);
  }

  /**
   * Escalate a request from FACULTY level to ADMIN level.
   * Called by EscalationScheduler after escalation timeout.
   */
  async escalate(approvalId: string, client?: PoolClient): Promise<ApprovalRequest | null> {
    const executor = client ?? this.db;

    // Deactivate all current faculty assignments
    await executor.query(
      `UPDATE approver_assignments
       SET is_active = FALSE
       WHERE approval_id = $1 AND approver_role = 'FACULTY'`,
      [approvalId],
    );

    const result = await executor.query(
      `UPDATE approval_requests
       SET status        = 'AWAITING_ADMIN',
           current_level = 'ADMIN',
           escalated_at  = NOW(),
           updated_at    = NOW()
       WHERE id = $1
         AND status = 'AWAITING_FACULTY'
       RETURNING *`,
      [approvalId],
    );

    if (!result.rows.length) return null;

    logger.info({
      component:  'ApprovalRepository',
      action:     'ESCALATED_TO_ADMIN',
      approvalId,
    });

    return rowToApprovalRequest(result.rows[0]);
  }

  /** Find all approval requests pending escalation (created > escalationHours ago, still AWAITING_FACULTY) */
  async findPendingEscalation(escalationHours: number): Promise<ApprovalRequest[]> {
    const result = await this.db.query(
      `SELECT * FROM approval_requests
       WHERE status = 'AWAITING_FACULTY'
         AND created_at < NOW() - INTERVAL '1 hour' * $1
       ORDER BY created_at ASC`,
      [escalationHours],
    );
    return result.rows.map(rowToApprovalRequest);
  }

  // ── Approver Assignments ─────────────────────────────────────────────────────

  /** Assign a batch of approvers to an approval request */
  async createAssignments(params: {
    approvalId:  string;
    approvers:   Array<{ id: string; email: string; role: 'FACULTY' | 'ADMIN' }>;
  }, client?: PoolClient): Promise<ApproverAssignment[]> {
    const executor = client ?? this.db;
    const assignments: ApproverAssignment[] = [];

    for (const approver of params.approvers) {
      const id = uuidv4();
      const result = await executor.query(
        `INSERT INTO approver_assignments
           (id, approval_id, approver_id, approver_email, approver_role)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [id, params.approvalId, approver.id, approver.email, approver.role],
      );
      assignments.push(rowToAssignment(result.rows[0]));
    }

    return assignments;
  }

  /** Get all active assignments for a given approval */
  async findActiveAssignments(approvalId: string): Promise<ApproverAssignment[]> {
    const result = await this.db.query(
      `SELECT * FROM approver_assignments
       WHERE approval_id = $1 AND is_active = TRUE`,
      [approvalId],
    );
    return result.rows.map(rowToAssignment);
  }

  /** Check if an approver is actively assigned to this approval */
  async isAssignedApprover(approvalId: string, approverId: string): Promise<boolean> {
    const result = await this.db.query(
      `SELECT 1 FROM approver_assignments
       WHERE approval_id = $1 AND approver_id = $2 AND is_active = TRUE`,
      [approvalId, approverId],
    );
    return result.rows.length > 0;
  }

  /**
   * Mark an approval as REJECTED due to booking cancellation.
   * Called when a student cancels their booking.
   * This removes the approval from faculty pending list.
   */
  async rejectDueToBookingCancellation(bookingId: string): Promise<ApprovalRequest | null> {
    const result = await this.db.query(
      `UPDATE approval_requests
       SET status           = 'REJECTED',
           decided_by_id    = 'SYSTEM',
           decided_by_email = 'system@unibook.local',
           decision_reason  = 'Booking cancelled by requester',
           decided_at       = NOW(),
           updated_at       = NOW()
       WHERE booking_id = $1
         AND status IN ('AWAITING_FACULTY', 'AWAITING_ADMIN')
       RETURNING *`,
      [bookingId],
    );

    if (!result.rows.length) return null;

    const approvalId = result.rows[0].id;

    // Deactivate all assignments for this approval
    await this.db.query(
      `UPDATE approver_assignments
       SET is_active = FALSE,
           decided_at = NOW()
       WHERE approval_id = $1`,
      [approvalId],
    );

    logger.info({
      component: 'ApprovalRepository',
      action: 'REJECTED_DUE_TO_BOOKING_CANCELLATION',
      approvalId,
      bookingId,
    });

    return rowToApprovalRequest(result.rows[0]);
  }
}
