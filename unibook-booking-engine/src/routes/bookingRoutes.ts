// src/routes/bookingRoutes.ts
// Booking Engine REST API — FR-3, FR-4.
//
// POST   /bookings              — Submit a booking (STUDENT, FACULTY)
// GET    /bookings/mine         — My bookings (any authenticated user)
// GET    /bookings/:id          — Get single booking
// DELETE /bookings/:id          — Cancel a booking (owner or ADMIN)

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { validateToken }   from '../middleware/validateToken';
import { enforceRole }     from '../middleware/roleGuard';
import type { BookingFacade }  from '../services/BookingFacade';
import type { BookingRequest } from '../types';
import { logger }          from '../utils/logger';
import { config }          from '../config';

export function createBookingRouter(facade: BookingFacade): Router {
  const router = Router();

  // ── POST /bookings ─────────────────────────────────────────────────────────
  router.post(
    '/',
    validateToken,
    enforceRole(['STUDENT', 'FACULTY', 'ADMIN']),
    async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.correlationId;

      // Validate required fields
      const { resourceId, startTime, endTime, purpose, attendeeCount } = req.body as Partial<BookingRequest>;

      if (!resourceId || !startTime || !endTime || !purpose || !attendeeCount) {
        res.status(400).json({
          error: 'Missing required fields: resourceId, startTime, endTime, purpose, attendeeCount',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      // Purpose max 500 chars (FR-3)
      if (typeof purpose === 'string' && purpose.length > 500) {
        res.status(400).json({ error: 'Purpose must be 500 characters or fewer.', code: 'VALIDATION_ERROR' });
        return;
      }

      if (typeof attendeeCount !== 'number' || attendeeCount < 1) {
        res.status(400).json({ error: 'attendeeCount must be a positive integer.', code: 'VALIDATION_ERROR' });
        return;
      }

      // Parse and validate times
      const start = new Date(startTime as string);
      const end   = new Date(endTime as string);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ error: 'startTime and endTime must be valid ISO 8601 dates.', code: 'VALIDATION_ERROR' });
        return;
      }
      if (end <= start) {
        res.status(400).json({ error: 'endTime must be after startTime.', code: 'VALIDATION_ERROR' });
        return;
      }
      if (start < new Date()) {
        res.status(400).json({ error: 'Cannot book a slot in the past.', code: 'VALIDATION_ERROR' });
        return;
      }

      // idempotency_key — from header or body; generate one if missing
      const idempotencyKey =
        (req.headers['idempotency-key'] as string) ||
        (req.body as Record<string, string>).idempotencyKey ||
        uuidv4();

      const request: BookingRequest = {
        resourceId:    resourceId as string,
        startTime:     start.toISOString(),
        endTime:       end.toISOString(),
        purpose:       purpose as string,
        attendeeCount: attendeeCount as number,
        idempotencyKey,
      };

      try {
        const { statusCode, body } = await facade.submitBooking(
          request,
          req.user!,
          correlationId,
        );
        res.status(statusCode).json(body);
      } catch (err) {
        logger.error({
          correlationId,
          component: 'bookingRoutes',
          action:    'SUBMIT_ERROR',
          error:     (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /bookings/mine ─────────────────────────────────────────────────────
  router.get(
    '/mine',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const bookings = await facade.getMyBookings(req.user!.sub);
        res.json({ bookings });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'bookingRoutes',
          action:        'GET_MINE_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /bookings/:id ──────────────────────────────────────────────────────
  router.get(
    '/:id',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const booking = await facade.getBooking(req.params.id);
        if (!booking) {
          res.status(404).json({ error: 'Booking not found', code: 'NOT_FOUND' });
          return;
        }
        // Users can only see their own bookings unless they are ADMIN
        if (booking.userId !== req.user!.sub && req.user!.role !== 'ADMIN') {
          res.status(403).json({ error: 'Access denied', code: 'INSUFFICIENT_ROLE' });
          return;
        }
        res.json(booking);
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'bookingRoutes',
          action:        'GET_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── DELETE /bookings/:id ───────────────────────────────────────────────────
  router.delete(
    '/:id',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const booking = await facade.cancelBooking(
          req.params.id,
          req.user!.sub,
          req.user!.role,
          req.correlationId,
        );

        if (!booking) {
          res.status(404).json({
            error: 'Booking not found, already cancelled, or you do not have permission.',
            code:  'NOT_FOUND_OR_FORBIDDEN',
          });
          return;
        }

        res.json({ message: 'Booking cancelled successfully.', booking });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'bookingRoutes',
          action:        'CANCEL_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── PATCH /bookings/:id/status ─────────────────────────────────────────────
  // Internal endpoint called by Approval Workflow (Subsystem 4) after a decision.
  // Protected by X-Service-Key header (shared JWT secret) — no user JWT needed.
  router.patch(
    '/:id/status',
    async (req: Request, res: Response): Promise<void> => {
      const serviceKey = req.headers['x-service-key'] as string;

      if (!serviceKey || serviceKey !== config.jwt.secret) {
        logger.warn({
          correlationId: req.correlationId,
          component:     'bookingRoutes',
          action:        'STATUS_UPDATE_UNAUTHORIZED',
          bookingId:     req.params.id,
        });
        res.status(401).json({ error: 'Invalid service key', code: 'UNAUTHORIZED' });
        return;
      }

      const { status } = req.body as { status?: string; reason?: string; decidedById?: string };
      const allowedStatuses = ['APPROVED', 'REJECTED'];

      if (!status || !allowedStatuses.includes(status)) {
        res.status(400).json({
          error: `status must be one of: ${allowedStatuses.join(', ')}`,
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      try {
        const booking = await facade.updateBookingStatus(
          req.params.id,
          status as 'APPROVED' | 'REJECTED',
          req.correlationId,
        );

        if (!booking) {
          res.status(404).json({ error: 'Booking not found', code: 'NOT_FOUND' });
          return;
        }

        logger.info({
          correlationId: req.correlationId,
          component:     'bookingRoutes',
          action:        'STATUS_UPDATED_BY_APPROVAL',
          bookingId:     req.params.id,
          newStatus:     status,
        });

        res.json({ message: `Booking status updated to ${status}.`, booking });
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'bookingRoutes',
          action:        'STATUS_UPDATE_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  return router;
}
