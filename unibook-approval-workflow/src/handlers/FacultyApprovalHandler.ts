// src/handlers/FacultyApprovalHandler.ts
// Chain of Responsibility — Faculty handler (GoF Pattern 14 / Behavioral)
//
// Handles approval requests from STUDENT users:
//   • Creates approval request at AWAITING_FACULTY level
//   • Queries all FACULTY users via IAM and assigns them all
//   • "Broadcast to all; first-one-wins"
//   • If requester is not STUDENT, passes to next handler (Admin)

import axios from 'axios';
import { AbstractApprovalHandler } from './AbstractApprovalHandler';
import type { HandlerContext, HandlerResult } from './IApprovalHandler';
import type { ApprovalRequest } from '../types';
import type { ApprovalRepository } from '../repositories/ApprovalRepository';
import { config } from '../config';
import { logger } from '../utils/logger';

export class FacultyApprovalHandler extends AbstractApprovalHandler {
  constructor(private readonly approvalRepo: ApprovalRepository) {
    super();
  }

  async handle(context: HandlerContext): Promise<HandlerResult> {
    // This handler manages STUDENT bookings (and IT_STAFF if configured similarly)
    if (context.requesterRole !== 'STUDENT') {
      // Pass to next handler (AdminApprovalHandler handles FACULTY bookings)
      if (this.nextHandler) {
        return this.nextHandler.handle(context);
      }
      return { handled: false, message: 'No handler for this role' };
    }

    logger.info({
      correlationId: context.correlationId,
      component:     'FacultyApprovalHandler',
      action:        'HANDLING',
      bookingId:     context.bookingId,
      requesterRole: context.requesterRole,
    });

    // 1. Create approval request at faculty level
    const approval = await this.approvalRepo.createApprovalRequest({
      bookingId:      context.bookingId,
      resourceId:     context.resourceId,
      requesterId:    context.requesterId,
      requesterEmail: context.requesterEmail,
      requesterRole:  context.requesterRole as ApprovalRequest['requesterRole'],
      requesterName:  context.requesterName,
      department:     context.department,
      startTime:      context.startTime,
      endTime:        context.endTime,
      purpose:        context.purpose,
      resourceName:   context.resourceName,
      initialStatus:  'AWAITING_FACULTY',
      currentLevel:   'FACULTY',
    });

    // 2. Fetch all faculty users from IAM
    const faculty = await this.fetchApprovers('FACULTY', context.correlationId);

    if (faculty.length === 0) {
      logger.warn({
        correlationId: context.correlationId,
        component:     'FacultyApprovalHandler',
        action:        'NO_FACULTY_FOUND',
        message:       'No faculty users found — approval will require manual intervention',
      });
    }

    // 3. Always record assignments (even empty) — keeps the repository call consistent
    //    and allows future admins to assign reviewers manually.
    await this.approvalRepo.createAssignments({
      approvalId: approval.id,
      approvers:  faculty.map(f => ({ id: f.id, email: f.email, role: 'FACULTY' as const })),
    });

    logger.info({
      correlationId:  context.correlationId,
      component:      'FacultyApprovalHandler',
      action:         'APPROVAL_CREATED',
      approvalId:     approval.id,
      bookingId:      context.bookingId,
      assignedCount:  faculty.length,
    });

    return {
      handled:    true,
      approvalId: approval.id,
      level:      'FACULTY',
      message:    `Approval request created at FACULTY level. Assigned to ${faculty.length} faculty member(s).`,
    };
  }

  /** Fetch approvers of a given role from the IAM service */
  private async fetchApprovers(
    role: string,
    correlationId?: string,
  ): Promise<Array<{ id: string; email: string }>> {
    try {
      const response = await axios.get<{ users: Array<{ id: string; email: string }> }>(
        `${config.services.iamUrl}/auth/internal/users?role=${role}`,
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
        component: 'FacultyApprovalHandler',
        action:    'IAM_FETCH_FAILED',
        role,
        error:     (err as Error).message,
      });
      return [];
    }
  }
}
