// src/routes/approvalRoutes.ts
// Approval Workflow REST API — FR-5.
//
// GET    /approvals/pending         — Get pending approvals for the current approver
// GET    /approvals/my              — Requester: get my submitted booking approvals
// GET    /approvals/:id             — Get a single approval by ID
// GET    /approvals/booking/:bookingId — Get approval by booking ID
// POST   /approvals/:id/decide      — Approver records a decision (APPROVE/REJECT/SUGGEST_ALTERNATIVE)
//
// Internal (no JWT — called by Booking Engine with service key):
// POST   /approvals/internal/booking-submitted — Intake a new BookingSubmitted event

import { Router, Request, Response } from 'express';
import { validateToken }   from '../middleware/validateToken';
import { enforceRole }     from '../middleware/roleGuard';
import type { ApprovalService }    from '../services/ApprovalService';
import type { DecisionRequest }    from '../types';
import { logger }          from '../utils/logger';
import { config }          from '../config';

export function createApprovalRouter(service: ApprovalService): Router {
  const router = Router();

  // ── Internal webhook — Booking Engine calls this after creating a booking ──
  // Protected by a shared service key (X-Service-Key header), not a user JWT.
  router.post(
    '/internal/booking-submitted',
    async (req: Request, res: Response): Promise<void> => {
      const serviceKey = req.headers['x-service-key'] as string;

      if (!serviceKey || serviceKey !== config.jwt.secret) {
        logger.warn({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'INVALID_SERVICE_KEY',
        });
        res.status(401).json({ error: 'Invalid service key', code: 'UNAUTHORIZED' });
        return;
      }

      const event = req.body;
      if (!event || !event.bookingId || !event.userId || !event.userRole) {
        res.status(400).json({ error: 'Invalid event payload', code: 'VALIDATION_ERROR' });
        return;
      }

      try {
        // Process asynchronously so Booking Engine gets immediate 202 response
        setImmediate(async () => {
          await service.onBookingSubmitted(event).catch((err: Error) => {
            logger.error({
              correlationId: req.correlationId,
              component:     'approvalRoutes',
              action:        'BOOKING_SUBMITTED_HANDLER_FAILED',
              error:         err.message,
            });
          });
        });

        res.status(202).json({ message: 'Booking event received and queued for processing.' });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'BOOKING_SUBMITTED_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── Internal webhook — Booking Engine calls this when a booking is cancelled ──
  // Protected by a shared service key (X-Service-Key header), not a user JWT.
  router.post(
    '/internal/booking-cancelled',
    async (req: Request, res: Response): Promise<void> => {
      const serviceKey = req.headers['x-service-key'] as string;

      if (!serviceKey || serviceKey !== config.jwt.secret) {
        logger.warn({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'INVALID_SERVICE_KEY_BOOKING_CANCELLED',
        });
        res.status(401).json({ error: 'Invalid service key', code: 'UNAUTHORIZED' });
        return;
      }

      const event = req.body;
      if (!event || !event.bookingId || !event.userId) {
        res.status(400).json({ error: 'Invalid event payload', code: 'VALIDATION_ERROR' });
        return;
      }

      try {
        // Process asynchronously so Booking Engine gets immediate 202 response
        setImmediate(async () => {
          await service.onBookingCancelled(event).catch((err: Error) => {
            logger.error({
              correlationId: req.correlationId,
              component:     'approvalRoutes',
              action:        'BOOKING_CANCELLED_HANDLER_FAILED',
              error:         err.message,
            });
          });
        });

        res.status(202).json({ message: 'Booking cancellation event received and queued for processing.' });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'BOOKING_CANCELLED_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /approvals/pending — Pending approvals for the calling faculty/admin ──
  router.get(
    '/pending',
    validateToken,
    enforceRole(['FACULTY', 'ADMIN']),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const approvals = await service.getPendingForApprover(req.user!.sub);
        res.json({ approvals });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'GET_PENDING_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /approvals/my — All approvals I submitted as Requester ──────────────
  router.get(
    '/my',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const approvals = await service.getMyApprovals(req.user!.sub);
        res.json({ approvals });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'GET_MY_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /approvals/booking/:bookingId — Approval status for a booking ───────
  router.get(
    '/booking/:bookingId',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const approval = await service.getApprovalByBookingId(req.params.bookingId);
        if (!approval) {
          res.status(404).json({ error: 'No approval found for this booking', code: 'NOT_FOUND' });
          return;
        }
        // Only the requester, or FACULTY/ADMIN, may see the approval
        const user = req.user!;
        if (
          approval.requesterId !== user.sub &&
          user.role !== 'FACULTY' &&
          user.role !== 'ADMIN'
        ) {
          res.status(403).json({ error: 'Access denied', code: 'INSUFFICIENT_ROLE' });
          return;
        }
        res.json({ approval });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'GET_BY_BOOKING_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /approvals/:id — Single approval by approval ID ─────────────────────
  router.get(
    '/:id',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const approval = await service.getApproval(req.params.id);
        if (!approval) {
          res.status(404).json({ error: 'Approval not found', code: 'NOT_FOUND' });
          return;
        }

        // Only the requester, or FACULTY/ADMIN, may see the approval
        const user = req.user!;
        if (
          approval.requesterId !== user.sub &&
          user.role !== 'FACULTY' &&
          user.role !== 'ADMIN'
        ) {
          res.status(403).json({ error: 'Access denied', code: 'INSUFFICIENT_ROLE' });
          return;
        }

        res.json({ approval });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'approvalRoutes',
          action:        'GET_APPROVAL_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── POST /approvals/:id/decide — Approver records decision ──────────────────
  router.post(
    '/:id/decide',
    validateToken,
    enforceRole(['FACULTY', 'ADMIN']),
    async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.correlationId;
      const { decision, reason, alternativeStart, alternativeEnd } = req.body as DecisionRequest;

      if (!decision || !['APPROVE', 'REJECT', 'SUGGEST_ALTERNATIVE'].includes(decision)) {
        res.status(400).json({
          error: 'decision must be APPROVE, REJECT, or SUGGEST_ALTERNATIVE',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      try {
        const { approval, message } = await service.processDecision(
          req.params.id,
          req.user!.sub,
          req.user!.email,
          { decision, reason, alternativeStart, alternativeEnd },
          correlationId,
        );

        res.json({ approval, message });
      } catch (err) {
        const error = err as Error & { code?: string };
        const statusCodeMap: Record<string, number> = {
          NOT_FOUND:        404,
          ALREADY_DECIDED:  409,
          NOT_ASSIGNED:     403,
          VALIDATION_ERROR: 400,
        };
        const statusCode = (error.code && statusCodeMap[error.code]) ? statusCodeMap[error.code] : 500;

        logger.error({
          correlationId,
          component: 'approvalRoutes',
          action:    'DECIDE_ERROR',
          error:     error.message,
          code:      error.code,
        });

        res.status(statusCode).json({
          error: error.message,
          code:  error.code ?? 'INTERNAL_ERROR',
        });
      }
    },
  );

  return router;
}
