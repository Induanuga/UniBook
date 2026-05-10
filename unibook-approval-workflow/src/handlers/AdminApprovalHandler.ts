// src/handlers/AdminApprovalHandler.ts
// Chain of Responsibility — Admin handler (GoF Pattern 14 / Behavioral)
//
// Handles:
//   a) Direct assignments: FACULTY and IT_STAFF bookings → go straight to admins
//   b) Escalations: AWAITING_FACULTY requests that exceeded escalationHours
//
// All active ADMIN users are assigned (broadcast model).
// First admin to decide closes the request for all others.

import axios from 'axios';
import { AbstractApprovalHandler } from './AbstractApprovalHandler';
import type { HandlerContext, HandlerResult } from './IApprovalHandler';
import type { ApprovalRepository } from '../repositories/ApprovalRepository';
import { config } from '../config';
import { logger } from '../utils/logger';

export class AdminApprovalHandler extends AbstractApprovalHandler {
  constructor(private readonly approvalRepo: ApprovalRepository) {
    super();
  }

  async handle(context: HandlerContext): Promise<HandlerResult> {
    // This handler manages FACULTY and IT_STAFF bookings (direct admin approval)
    const directAdminRoles = ['FACULTY', 'IT_STAFF'];
    if (!directAdminRoles.includes(context.requesterRole)) {
      if (this.nextHandler) {
        return this.nextHandler.handle(context);
      }
      return { handled: false, message: 'No handler for this role' };
    }

    logger.info({
      correlationId: context.correlationId,
      component:     'AdminApprovalHandler',
      action:        'HANDLING',
      bookingId:     context.bookingId,
      requesterRole: context.requesterRole,
    });

    // 1. Create approval request directly at admin level
    const approval = await this.approvalRepo.createApprovalRequest({
      bookingId:      context.bookingId,
      resourceId:     context.resourceId,
      requesterId:    context.requesterId,
      requesterEmail: context.requesterEmail,
      requesterRole:  context.requesterRole as 'FACULTY' | 'IT_STAFF' | 'STUDENT' | 'ADMIN',
      requesterName:  context.requesterName,
      department:     context.department,
      startTime:      context.startTime,
      endTime:        context.endTime,
      purpose:        context.purpose,
      resourceName:   context.resourceName,
      initialStatus:  'AWAITING_ADMIN',
      currentLevel:   'ADMIN',
    });

    // 2. Fetch all admin users from IAM
    const admins = await this.fetchAdmins(context.correlationId);

    if (admins.length > 0) {
      await this.approvalRepo.createAssignments({
        approvalId: approval.id,
        approvers:  admins.map(a => ({ id: a.id, email: a.email, role: 'ADMIN' as const })),
      });
    } else {
      logger.warn({
        correlationId: context.correlationId,
        component:     'AdminApprovalHandler',
        action:        'NO_ADMINS_FOUND',
        message:       'No admin users found — approval created but unassigned',
      });
    }

    logger.info({
      correlationId:  context.correlationId,
      component:      'AdminApprovalHandler',
      action:         'APPROVAL_CREATED',
      approvalId:     approval.id,
      bookingId:      context.bookingId,
      assignedCount:  admins.length,
    });

    return {
      handled:    true,
      approvalId: approval.id,
      level:      'ADMIN',
      message:    `Approval request created at ADMIN level. Assigned to ${admins.length} admin(s).`,
    };
  }

  /**
   * Assign admins to an EXISTING approval request (used during escalation).
   * Called by EscalationScheduler — not part of the chain's normal flow.
   */
  async assignAdminsToExistingApproval(
    approvalId:    string,
    correlationId?: string,
  ): Promise<number> {
    const admins = await this.fetchAdmins(correlationId);

    if (admins.length === 0) {
      logger.warn({
        correlationId,
        component:  'AdminApprovalHandler',
        action:     'ESCALATION_NO_ADMINS',
        approvalId,
      });
      return 0;
    }

    await this.approvalRepo.createAssignments({
      approvalId,
      approvers: admins.map(a => ({ id: a.id, email: a.email, role: 'ADMIN' as const })),
    });

    logger.info({
      correlationId,
      component:     'AdminApprovalHandler',
      action:        'ESCALATION_ADMINS_ASSIGNED',
      approvalId,
      assignedCount: admins.length,
    });

    return admins.length;
  }

  private async fetchAdmins(correlationId?: string): Promise<Array<{ id: string; email: string }>> {
    try {
      const response = await axios.get<{ users: Array<{ id: string; email: string }> }>(
        `${config.services.iamUrl}/auth/internal/users?role=ADMIN`,
        {
          headers: {
            'X-Correlation-ID': correlationId ?? '',
            'X-Service-Key':    config.jwt.secret,
          },
          timeout: 3000,
        },
      );
      return response.data.users ?? [];
    } catch (err) {
      logger.warn({
        correlationId,
        component: 'AdminApprovalHandler',
        action:    'IAM_FETCH_ADMIN_FAILED',
        error:     (err as Error).message,
      });
      return [];
    }
  }
}
