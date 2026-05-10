// src/services/ApprovalService.ts
// Core service for the Approval Workflow subsystem.
// Orchestrates: chain routing, decision recording, status propagation back to Booking Engine.
//
// Design Patterns:
//   - Chain of Responsibility (via ApprovalHandlerChain)
//   - Observer (publishes ApprovalDecided events)
//   - Repository (via ApprovalRepository)
//   - Facade (this service is the single entry point used by routes)

import axios from 'axios';
import type { Pool } from 'pg';
import type {
  ApprovalRequest,
  DecisionRequest,
  BookingSubmittedEvent,
  BookingEvent,
} from '../types';
import { ApprovalRepository } from '../repositories/ApprovalRepository';
import { ApprovalHandlerChain } from '../handlers/ApprovalHandlerChain';
import { config } from '../config';
import { logger } from '../utils/logger';

export class ApprovalService {
  private readonly repo: ApprovalRepository;
  private chain: ApprovalHandlerChain;

  constructor(private readonly db: Pool, private readonly bookingDb?: Pool) {
    this.repo  = new ApprovalRepository(db);
    // Synchronous default chain — replaced by the DB-driven chain after init() resolves.
    // NFR-3: init() reads approval_handler_config and rebuilds the chain from DB config.
    this.chain = ApprovalHandlerChain.buildDefault(this.repo);
  }

  /**
   * Initialise the DB-driven handler chain.
   * Must be called once after construction (e.g. in server.ts before accepting requests).
   *
   * NFR-3: Reads approval_handler_config table and assembles the chain from DB rows.
   * Adding a new approval role = one new row in approval_handler_config, zero code changes.
   */
  async init(): Promise<void> {
    this.chain = await ApprovalHandlerChain.build(this.repo, this.db);
    logger.info({
      component: 'ApprovalService',
      action:    'CHAIN_INITIALISED',
      message:   'DB-driven handler chain ready',
    });
  }

  /**
   * Triggered by BookingSubmitted event from the Booking Engine.
   * Routes the booking through the handler chain to create the approval request.
   */
  async onBookingSubmitted(event: BookingSubmittedEvent): Promise<void> {
    logger.info({
      correlationId: event.correlationId,
      component: 'ApprovalService',
      action: 'BOOKING_SUBMITTED_RECEIVED',
      bookingId: event.bookingId,
      userRole: event.userRole,
    });

    // Check for duplicate (idempotency — same bookingId already processed)
    const existing = await this.repo.findByBookingId(event.bookingId);
    if (existing) {
      logger.info({
        correlationId: event.correlationId,
        component: 'ApprovalService',
        action: 'DUPLICATE_BOOKING_SKIPPED',
        bookingId: event.bookingId,
      });
      return;
    }

    const result = await this.chain.handle({
      bookingId: event.bookingId,
      resourceId: event.resourceId,
      requesterId: event.userId,
      requesterEmail: event.userEmail,
      requesterRole: event.userRole,
      requesterName: event.userName ?? event.userEmail,
      department: event.department,
      startTime: new Date(event.startTime),
      endTime: new Date(event.endTime),
      purpose: event.purpose,
      resourceName: event.resourceName,
      correlationId: event.correlationId,
    });

    if (!result.handled) {
      logger.error({
        correlationId: event.correlationId,
        component: 'ApprovalService',
        action: 'CHAIN_UNHANDLED',
        bookingId: event.bookingId,
        message: result.message,
      });
    } else {
      // Notify Subsystem 5 — inform assigned approvers of pending request (Observer)
      setImmediate(() => {
        this.notifyNotificationService(
          'ASSIGNMENT_PENDING',
          event.correlationId,
          {
            recipientId: '__BROADCAST__',   // replaced per-user in Notif. Service future work
            recipientEmail: '__BROADCAST__',   // Workaround: Approval Workflow notifies requester's side
            // For assignment notifications we send per-approver logic via the handler chain;
            // here we send a "submitted" confirmation to the requester themselves.
          },
          {
            bookingId: event.bookingId,
            approvalId: result.approvalId,
            resourceName: event.resourceName,
            startTime: event.startTime,
            endTime: event.endTime,
            recipientId: event.userId,
            recipientEmail: event.userEmail,
            recipientName: event.userName,
          },
          'BOOKING_SUBMITTED',
        ).catch(() => { /* non-fatal */ });
      });
    }
  }

  /**
   * Triggered by BookingCancelled event from the Booking Engine.
   * Automatically rejects the pending approval request.
   * Removes the booking from the faculty/admin pending list.
   */
  async onBookingCancelled(event: BookingEvent): Promise<void> {
    logger.info({
      correlationId: event.correlationId,
      component: 'ApprovalService',
      action: 'BOOKING_CANCELLED_RECEIVED',
      bookingId: event.bookingId,
      userId: event.userId,
    });

    // Find and reject the approval request for this booking
    const approval = await this.repo.findByBookingId(event.bookingId);
    
    if (!approval) {
      logger.info({
        correlationId: event.correlationId,
        component: 'ApprovalService',
        action: 'NO_PENDING_APPROVAL_FOR_CANCELLED_BOOKING',
        bookingId: event.bookingId,
      });
      return;
    }

    // Only reject if still pending (not already decided)
    if (!['AWAITING_FACULTY', 'AWAITING_ADMIN'].includes(approval.status)) {
      logger.info({
        correlationId: event.correlationId,
        component: 'ApprovalService',
        action: 'APPROVAL_ALREADY_DECIDED_SKIPPED',
        bookingId: event.bookingId,
        approvalId: approval.id,
        currentStatus: approval.status,
      });
      return;
    }

    // Reject the approval request
    const updated = await this.repo.rejectDueToBookingCancellation(event.bookingId);

    if (!updated) {
      logger.error({
        correlationId: event.correlationId,
        component: 'ApprovalService',
        action: 'FAILED_TO_REJECT_APPROVAL_ON_CANCELLATION',
        bookingId: event.bookingId,
      });
      return;
    }

    logger.info({
      correlationId: event.correlationId,
      component: 'ApprovalService',
      action: 'APPROVAL_REJECTED_DUE_TO_BOOKING_CANCELLATION',
      approvalId: updated.id,
      bookingId: event.bookingId,
    });

    // Notify the requester that their approval request was cancelled (due to booking cancellation)
    setImmediate(() => {
      this.notifyNotificationService(
        'BOOKING_CANCELLED_APPROVAL_REJECTED',
        event.correlationId,
        {},
        {
          recipientId: approval.requesterId,
          recipientEmail: approval.requesterEmail,
          recipientName: approval.requesterName,
          bookingId: event.bookingId,
          approvalId: updated.id,
          resourceName: approval.resourceName,
          startTime: approval.startTime.toISOString(),
          endTime: approval.endTime.toISOString(),
        },
      ).catch(() => { /* non-fatal */ });
    });
  }

  /**
   * Process an approver's decision (APPROVE / REJECT / SUGGEST_ALTERNATIVE).
   * Validates that the approver is actively assigned.
   * If approved/rejected, notifies the Booking Engine to update booking status.
   */
  async processDecision(
    approvalId: string,
    approverId: string,
    approverEmail: string,
    request: DecisionRequest,
    correlationId?: string,
  ): Promise<{ approval: ApprovalRequest; message: string }> {

    // 1. Load the approval request
    const approval = await this.repo.findById(approvalId);
    if (!approval) {
      throw Object.assign(new Error('Approval request not found'), { code: 'NOT_FOUND' });
    }

    // 2. Check it is still pending
    if (!['AWAITING_FACULTY', 'AWAITING_ADMIN'].includes(approval.status)) {
      throw Object.assign(new Error('This approval has already been decided'), { code: 'ALREADY_DECIDED' });
    }

    // 3. Check the approver is actively assigned
    const isAssigned = await this.repo.isAssignedApprover(approvalId, approverId);
    if (!isAssigned) {
      throw Object.assign(new Error('You are not assigned to approve this request'), { code: 'NOT_ASSIGNED' });
    }

    // 3.5. Check if the booking has been cancelled by the student
    const bookingCancelled = await this.isBookingCancelled(approval.bookingId);
    if (bookingCancelled) {
      throw Object.assign(
        new Error('Cannot approve this booking — it has been cancelled by the student'),
        { code: 'BOOKING_CANCELLED' },
      );
    }

    // 4. Validate alternative slot if SUGGEST_ALTERNATIVE
    if (request.decision === 'SUGGEST_ALTERNATIVE') {
      if (!request.alternativeStart || !request.alternativeEnd) {
        throw Object.assign(
          new Error('alternativeStart and alternativeEnd are required for SUGGEST_ALTERNATIVE'),
          { code: 'VALIDATION_ERROR' },
        );
      }
    }

    // 5. Record the decision (marks decider + deactivates all others — broadcast cleanup)
    const alternativeSlot = (request.decision === 'SUGGEST_ALTERNATIVE' && request.alternativeStart && request.alternativeEnd)
      ? { startTime: request.alternativeStart, endTime: request.alternativeEnd }
      : undefined;

    const updated = await this.repo.recordDecision({
      approvalId,
      approverId,
      approverEmail,
      decision: request.decision,
      reason: request.reason,
      alternativeSlot,
    });

    if (!updated) {
      throw new Error('Failed to record decision — approval may have been decided concurrently');
    }

    // 6. Notify Booking Engine to update booking status (Observer-style call)
    await this.notifyBookingEngine(updated, correlationId);

    // 7. Notify Analytics Service — forward the event for heatmap/summary tracking
    if (request.decision === 'APPROVE' || request.decision === 'REJECT' || request.decision === 'SUGGEST_ALTERNATIVE') {
      const analyticsEventType =
        request.decision === 'APPROVE'            ? 'BookingApproved' :
        request.decision === 'REJECT'             ? 'BookingRejected' :
        'BookingAlternativeSuggested';
      setImmediate(() => {
        this.notifyAnalyticsService(analyticsEventType, updated, correlationId).catch(() => { /* non-fatal */ });
      });
    }

    const messageMap: Record<string, string> = {
      APPROVE: 'Booking approved successfully.',
      REJECT: 'Booking rejected.',
      SUGGEST_ALTERNATIVE: 'Alternative slot suggested to requester.',
    };

    logger.info({
      correlationId,
      component: 'ApprovalService',
      action: 'DECISION_PROCESSED',
      approvalId,
      decision: request.decision,
      decidedBy: approverEmail,
    });

    // Notify Subsystem 5 — inform requester of decision (Observer)
    const notifEventMap: Record<string, string> = {
      APPROVE: 'BOOKING_APPROVED',
      REJECT: 'BOOKING_REJECTED',
      SUGGEST_ALTERNATIVE: 'ALTERNATIVE_SUGGESTED',
    };
    const notifEventType = notifEventMap[request.decision];
    if (notifEventType) {
      setImmediate(() => {
        this.notifyNotificationService(
          notifEventType,
          correlationId ?? approvalId,
          {},
          {
            recipientId: updated.requesterId,
            recipientEmail: updated.requesterEmail,
            recipientName: updated.requesterName,
            bookingId: updated.bookingId,
            approvalId: updated.id,
            resourceName: updated.resourceName,
            startTime: updated.startTime.toISOString(),
            endTime: updated.endTime.toISOString(),
            reason: request.reason,
          },
        ).catch(() => { /* non-fatal */ });
      });
    }

    return { approval: updated, message: messageMap[request.decision] };
  }

  /** Get all pending approvals for an approver — filters out cancelled bookings */
  async getPendingForApprover(approverId: string): Promise<ApprovalRequest[]> {
    const pending = await this.repo.findPendingForApprover(approverId);
    
    // Filter out approvals whose bookings have been cancelled (async race condition handling)
    const filtered: ApprovalRequest[] = [];
    for (const approval of pending) {
      const isCancelled = await this.isBookingCancelled(approval.bookingId);
      if (!isCancelled) {
        filtered.push(approval);
      } else {
        logger.info({
          component: 'ApprovalService',
          action: 'FILTERED_CANCELLED_BOOKING_FROM_PENDING',
          approvalId: approval.id,
          bookingId: approval.bookingId,
          approverId,
        });
      }
    }
    
    return filtered;
  }

  /** Get all approvals submitted by the requesting user */
  async getMyApprovals(requesterId: string): Promise<ApprovalRequest[]> {
    return this.repo.findByRequesterId(requesterId);
  }

  /** Get a single approval by ID */
  async getApproval(id: string): Promise<ApprovalRequest | null> {
    return this.repo.findById(id);
  }

  /** Get approval by booking ID */
  async getApprovalByBookingId(bookingId: string): Promise<ApprovalRequest | null> {
    return this.repo.findByBookingId(bookingId);
  }

  /** Get all pending approvals at a level — filters out cancelled bookings */
  async getAllPendingAtLevel(level: 'FACULTY' | 'ADMIN'): Promise<ApprovalRequest[]> {
    const pending = await this.repo.findPendingByLevel(level);
    
    // Filter out approvals whose bookings have been cancelled (async race condition handling)
    const filtered: ApprovalRequest[] = [];
    for (const approval of pending) {
      const isCancelled = await this.isBookingCancelled(approval.bookingId);
      if (!isCancelled) {
        filtered.push(approval);
      } else {
        logger.info({
          component: 'ApprovalService',
          action: 'FILTERED_CANCELLED_BOOKING_FROM_LEVEL_PENDING',
          approvalId: approval.id,
          bookingId: approval.bookingId,
          level,
        });
      }
    }
    
    return filtered;
  }

  /**
   * Escalate a pending faculty-level approval to admin level.
   * Called by EscalationScheduler after escalation timeout.
   */
  async escalateToAdmin(approvalId: string, correlationId?: string): Promise<boolean> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const escalated = await this.repo.escalate(approvalId, client);
      if (!escalated) {
        await client.query('ROLLBACK');
        return false;
      }

      // Assign all admins to the newly escalated request
      const adminAssigned = await this.chain.getAdminHandler()
        .assignAdminsToExistingApproval(approvalId, correlationId);

      await client.query('COMMIT');

      logger.info({
        correlationId,
        component: 'ApprovalService',
        action: 'ESCALATED_TO_ADMIN',
        approvalId,
        adminAssigned,
      });

      // Notify Subsystem 5 — inform admins of escalated booking
      const escalated2 = await this.repo.findById(approvalId);
      if (escalated2) {
        setImmediate(() => {
          this.notifyNotificationService(
            'ESCALATION_ASSIGNED',
            correlationId ?? approvalId,
            {},
            {
              recipientId: '__ADMIN_BROADCAST__',   // Logged; actual per-admin delivery is future work
              recipientEmail: '__ADMIN_BROADCAST__',
              bookingId: escalated2.bookingId,
              approvalId: escalated2.id,
              resourceName: escalated2.resourceName,
              startTime: escalated2.startTime.toISOString(),
              endTime: escalated2.endTime.toISOString(),
            },
          ).catch(() => { /* non-fatal */ });
        });
      }

      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({
        correlationId,
        component: 'ApprovalService',
        action: 'ESCALATION_FAILED',
        approvalId,
        error: (err as Error).message,
      });
      return false;
    } finally {
      client.release();
    }
  }

  /** Find all approvals pending escalation */
  async getPendingEscalations(): Promise<ApprovalRequest[]> {
    return this.repo.findPendingEscalation(config.escalation.escalationHours);
  }

  /**
   * Check if a booking has been cancelled.
   * Used to prevent approving a booking that was already cancelled by the student.
   */
  private async isBookingCancelled(bookingId: string): Promise<boolean> {
    if (!this.bookingDb) {
      logger.warn({
        component: 'ApprovalService',
        action: 'BOOKING_DB_NOT_AVAILABLE',
        message: 'Cannot check booking status — bookingDb not initialized',
      });
      return false;  // Assume not cancelled if we can't check
    }

    try {
      const result = await this.bookingDb.query(
        'SELECT status FROM bookings WHERE id = $1',
        [bookingId],
      );

      if (!result.rows.length) {
        logger.warn({
          component: 'ApprovalService',
          action: 'BOOKING_NOT_FOUND_IN_DB',
          bookingId,
        });
        return false;  // Booking not found
      }

      const status = result.rows[0].status;
      return status === 'CANCELLED';
    } catch (err) {
      logger.error({
        component: 'ApprovalService',
        action: 'FAILED_TO_CHECK_BOOKING_STATUS',
        bookingId,
        error: (err as Error).message,
      });
      return false;  // Assume not cancelled if query fails
    }
  }

  /**
   * Notify Booking Engine to update booking status after a decision.
   * Handles APPROVE → updates booking to APPROVED
   * Handles REJECT  → updates booking to REJECTED
   * SUGGEST_ALTERNATIVE → keeps booking PENDING (user must re-book)
   *
   * Observer pattern: Approval Workflow publishes decisions;
   * Booking Engine reacts without Approval Workflow knowing its internals.
   */
  private async notifyBookingEngine(
    approval: ApprovalRequest,
    correlationId?: string,
  ): Promise<void> {
    const statusMap: Record<string, string | null> = {
      APPROVED: 'APPROVED',
      REJECTED: 'REJECTED',
      ALTERNATIVE_SUGGESTED: null,  // Booking Engine does not change status yet
    };

    const newStatus = statusMap[approval.status];
    if (!newStatus) return;

    try {
      await axios.patch(
        `${config.services.bookingEngineUrl}/bookings/${approval.bookingId}/status`,
        {
          status: newStatus,
          reason: approval.decisionReason,
          decidedById: approval.decidedById,
          decidedByEmail: approval.decidedByEmail,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Correlation-ID': correlationId ?? '',
            'X-Service-Key': config.jwt.secret, // Internal service auth
          },
          timeout: 5000,
        },
      );

      logger.info({
        correlationId,
        component: 'ApprovalService',
        action: 'BOOKING_ENGINE_NOTIFIED',
        bookingId: approval.bookingId,
        newStatus,
      });
    } catch (err) {
      // Non-fatal — log and continue. Booking Engine may be temporarily unavailable.
      logger.error({
        correlationId,
        component: 'ApprovalService',
        action: 'BOOKING_ENGINE_NOTIFY_FAILED',
        bookingId: approval.bookingId,
        newStatus,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Notify Subsystem 5 (Notification Service) of an event.
   * Fire-and-forget — non-fatal if unavailable.
   * Observer pattern: Approval Workflow publishes events; Notification Service subscribes.
   */
  private async notifyNotificationService(
    eventType: string,
    correlationId: string,
    _ignored: Record<string, unknown>,
    payload: {
      recipientId: string;
      recipientEmail: string;
      recipientName?: string;
      bookingId?: string;
      approvalId?: string;
      resourceName?: string;
      startTime?: string;
      endTime?: string;
      reason?: string;
    },
    overrideEventType?: string,
  ): Promise<void> {
    const finalEventType = overrideEventType ?? eventType;
    try {
      await axios.post(
        `${config.services.notificationServiceUrl}/notifications/internal/event`,
        {
          eventType: finalEventType,
          correlationId,
          recipientId: payload.recipientId,
          recipientEmail: payload.recipientEmail,
          recipientName: payload.recipientName,
          bookingId: payload.bookingId,
          approvalId: payload.approvalId,
          resourceName: payload.resourceName,
          startTime: payload.startTime,
          endTime: payload.endTime,
          reason: payload.reason,
          timestamp: new Date().toISOString(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Correlation-ID': correlationId,
            'X-Service-Key': config.jwt.secret,
          },
          timeout: 3000,
        },
      );

      logger.info({
        correlationId,
        component: 'ApprovalService',
        action: 'NOTIFICATION_SERVICE_NOTIFIED',
        eventType: finalEventType,
        recipientId: payload.recipientId,
      });
    } catch (err) {
      logger.warn({
        correlationId,
        component: 'ApprovalService',
        action: 'NOTIFICATION_SERVICE_NOTIFY_FAILED',
        eventType: finalEventType,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Notify Subsystem 6 (Analytics Service) of a booking lifecycle event.
   * Fire-and-forget — non-fatal if unavailable.
   * Called after APPROVE or REJECT decisions so heatmap and summary stay current.
   */
  private async notifyAnalyticsService(
    eventType: 'BookingApproved' | 'BookingRejected' | 'BookingCancelled' | 'BookingSubmitted' | 'BookingAlternativeSuggested',
    approval: ApprovalRequest,
    correlationId?: string,
  ): Promise<void> {
    try {
      await axios.post(
        `${config.services.analyticsServiceUrl}/analytics/internal/event`,
        {
          eventType,
          correlationId: correlationId ?? approval.id,
          bookingId:     approval.bookingId,
          resourceId:    approval.resourceId,
          userId:        approval.requesterId,
          department:    approval.department,
          startTime:     approval.startTime.toISOString(),
          endTime:       approval.endTime.toISOString(),
          timestamp:     new Date().toISOString(),
        },
        {
          headers: {
            'Content-Type':  'application/json',
            'X-Service-Key': config.jwt.secret,
          },
          timeout: 3000,
        },
      );
      logger.info({
        correlationId,
        component: 'ApprovalService',
        action:    'ANALYTICS_SERVICE_NOTIFIED',
        eventType,
        bookingId: approval.bookingId,
      });
    } catch (err) {
      logger.warn({
        correlationId,
        component: 'ApprovalService',
        action:    'ANALYTICS_SERVICE_NOTIFY_FAILED',
        eventType,
        error:     (err as Error).message,
      });
    }
  }
}
