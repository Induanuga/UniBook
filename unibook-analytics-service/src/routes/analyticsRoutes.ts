// src/routes/analyticsRoutes.ts
// Analytics & Reporting REST API (Subsystem 6)
//
// All user-facing routes require ADMIN role (FR-7, NFR-2).
// Internal webhook accepts a shared service key (no JWT).
//
// GET  /analytics/heatmap          — Utilisation heatmap (Admin only)
// GET  /analytics/summary          — Booking counts summary (Admin only)
// GET  /analytics/export.csv       — CSV export (Admin only)
//
// POST /analytics/internal/event   — Internal webhook from Booking Engine / Approval Workflow

import { Router, Request, Response } from 'express';
import { validateToken } from '../middleware/validateToken';
import { enforceRole }   from '../middleware/roleGuard';
import type { AnalyticsService } from '../services/AnalyticsService';
import type { AnalyticsEvent }   from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

/** Validate a YYYY-MM-DD date string. */
function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

export function createAnalyticsRouter(service: AnalyticsService): Router {
  const router = Router();

  // ── Internal webhook — Booking Engine / Approval Workflow posts events here ─
  router.post(
    '/internal/event',
    async (req: Request, res: Response): Promise<void> => {
      const serviceKey = req.headers['x-service-key'] as string;
      if (!serviceKey || serviceKey !== config.jwt.secret) {
        logger.warn({
          correlationId: req.correlationId,
          component:     'analyticsRoutes',
          action:        'INVALID_SERVICE_KEY',
        });
        res.status(401).json({ error: 'Invalid service key', code: 'UNAUTHORIZED' });
        return;
      }

      const event = req.body as AnalyticsEvent;
      if (
        !event?.eventType ||
        !['BookingApproved', 'BookingCancelled', 'BookingSubmitted', 'BookingRejected', 'BookingAlternativeSuggested'].includes(event.eventType) ||
        !event?.bookingId ||
        !event?.resourceId ||
        !event?.userId ||
        !event?.startTime ||
        !event?.endTime
      ) {
        res.status(400).json({ error: 'Invalid event payload', code: 'VALIDATION_ERROR' });
        return;
      }

      // Respond immediately; process asynchronously (Observer — fire and forget)
      res.status(202).json({ message: 'Analytics event received.' });

      setImmediate(async () => {
        await service.processEvent(event).catch((err: Error) => {
          logger.error({
            correlationId: req.correlationId,
            component:     'analyticsRoutes',
            action:        'EVENT_PROCESSING_FAILED',
            error:         err.message,
          });
        });
      });
    },
  );

  // ── GET /analytics/heatmap ────────────────────────────────────────────────
  // Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), resourceId?, department?
  router.get(
    '/heatmap',
    validateToken,
    enforceRole(['ADMIN']),
    async (req: Request, res: Response): Promise<void> => {
      const { from, to, resourceId, department } = req.query as Record<string, string>;

      if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
        res.status(400).json({
          error: 'Query params "from" and "to" are required in YYYY-MM-DD format.',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      if (from > to) {
        res.status(400).json({ error: '"from" must be before or equal to "to"', code: 'VALIDATION_ERROR' });
        return;
      }

      try {
        const result = await service.getHeatmap({ from, to, resourceId, department });
        res.json(result);
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'analyticsRoutes',
          action:        'HEATMAP_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /analytics/summary ────────────────────────────────────────────────
  // Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), department?, resourceId?
  router.get(
    '/summary',
    validateToken,
    enforceRole(['ADMIN']),
    async (req: Request, res: Response): Promise<void> => {
      const { from, to, department, resourceId } = req.query as Record<string, string>;

      if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
        res.status(400).json({
          error: 'Query params "from" and "to" are required in YYYY-MM-DD format.',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      try {
        const summary = await service.getSummary({ from, to, department: department || undefined, resourceId: resourceId || undefined });
        res.json(summary);
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'analyticsRoutes',
          action:        'SUMMARY_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /analytics/export.csv ─────────────────────────────────────────────
  // Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), resourceId?, department?
  router.get(
    '/export.csv',
    validateToken,
    enforceRole(['ADMIN']),
    async (req: Request, res: Response): Promise<void> => {
      const { from, to, resourceId, department } = req.query as Record<string, string>;

      if (!from || !to || !isValidDate(from) || !isValidDate(to)) {
        res.status(400).json({
          error: 'Query params "from" and "to" are required in YYYY-MM-DD format.',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      try {
        const csv = await service.exportCsv({ from, to, resourceId, department });
        const filename = `unibook-analytics-${from}-to-${to}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (err) {
        logger.error({
          correlationId: req.correlationId,
          component:     'analyticsRoutes',
          action:        'EXPORT_CSV_ERROR',
          error:         (err as Error).message,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  return router;
}
