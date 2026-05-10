// src/services/EscalationScheduler.ts
// Scheduled job — checks for faculty-level approvals that have exceeded
// the escalation timeout and escalates them to admin level.
//
// Design: Singleton pattern (one timer per process).
// Runs every 15 minutes via setInterval.
// Does NOT require node-cron (uses built-in setInterval for simplicity).

import type { ApprovalService } from './ApprovalService';
import { config }               from '../config';
import { logger }               from '../utils/logger';

export class EscalationScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs = 15 * 60 * 1000; // Every 15 minutes

  constructor(private readonly approvalService: ApprovalService) {}

  /** Start the escalation check loop */
  start(): void {
    if (this.intervalId) return; // Already running

    // Run immediately on start
    this.runCheck();

    this.intervalId = setInterval(() => {
      this.runCheck();
    }, this.checkIntervalMs);

    logger.info({
      component:          'EscalationScheduler',
      action:             'STARTED',
      checkIntervalMinutes: this.checkIntervalMs / 60000,
      escalationHours:    config.escalation.escalationHours,
    });
  }

  /** Stop the escalation check loop */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info({ component: 'EscalationScheduler', action: 'STOPPED' });
    }
  }

  /** Run one escalation check cycle */
  private async runCheck(): Promise<void> {
    logger.info({ component: 'EscalationScheduler', action: 'CHECK_START' });

    try {
      const pending = await this.approvalService.getPendingEscalations();

      if (pending.length === 0) {
        logger.info({ component: 'EscalationScheduler', action: 'NO_PENDING_ESCALATIONS' });
        return;
      }

      logger.info({
        component: 'EscalationScheduler',
        action:    'ESCALATING',
        count:     pending.length,
      });

      for (const approval of pending) {
        const correlationId = `escalation-${approval.id}`;
        const success = await this.approvalService.escalateToAdmin(approval.id, correlationId);

        if (success) {
          logger.info({
            component:  'EscalationScheduler',
            action:     'ESCALATION_SUCCESS',
            approvalId: approval.id,
            bookingId:  approval.bookingId,
          });
        } else {
          logger.warn({
            component:  'EscalationScheduler',
            action:     'ESCALATION_SKIPPED',
            approvalId: approval.id,
            message:    'Already decided or escalated by another process',
          });
        }
      }
    } catch (err) {
      logger.error({
        component: 'EscalationScheduler',
        action:    'CHECK_FAILED',
        error:     (err as Error).message,
      });
    }

    logger.info({ component: 'EscalationScheduler', action: 'CHECK_DONE' });
  }
}
