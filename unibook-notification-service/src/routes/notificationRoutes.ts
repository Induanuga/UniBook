// src/routes/notificationRoutes.ts
// Notification Service REST API
//
// GET  /notifications/my           — Get my notifications (JWT required)
// GET  /notifications/unread-count — Get unread count badge
// PATCH /notifications/:id/read    — Mark one notification read (JWT required)
// PATCH /notifications/read-all    — Mark all my notifications read (JWT required)
//
// Internal (service-key auth):
// POST /notifications/internal/event — Webhook from Approval Workflow

import { Router, Request, Response } from 'express';
import { validateToken } from '../middleware/validateToken';
import type { NotificationService } from '../services/NotificationService';
import type { NotificationEvent } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

export function createNotificationRouter(service: NotificationService): Router {
    const router = Router();

    // ── Internal webhook — Approval Workflow posts events here ─────────────────
    router.post(
        '/internal/event',
        async (req: Request, res: Response): Promise<void> => {
            const serviceKey = req.headers['x-service-key'] as string;
            if (!serviceKey || serviceKey !== config.jwt.secret) {
                logger.warn({
                    correlationId: req.correlationId,
                    component: 'notificationRoutes',
                    action: 'INVALID_SERVICE_KEY',
                });
                res.status(401).json({ error: 'Invalid service key', code: 'UNAUTHORIZED' });
                return;
            }

            const event = req.body as NotificationEvent;
            if (!event?.eventType || !event?.recipientId || !event?.recipientEmail) {
                res.status(400).json({ error: 'Invalid event payload', code: 'VALIDATION_ERROR' });
                return;
            }

            // Respond immediately; process asynchronously (Observer — fire and forget)
            res.status(202).json({ message: 'Notification event received.' });

            setImmediate(async () => {
                await service.processEvent(event).catch((err: Error) => {
                    logger.error({
                        correlationId: req.correlationId,
                        component: 'notificationRoutes',
                        action: 'EVENT_PROCESSING_FAILED',
                        error: err.message,
                    });
                });
            });
        },
    );

    // ── GET /notifications/my ──────────────────────────────────────────────────
    router.get(
        '/my',
        validateToken,
        async (req: Request, res: Response): Promise<void> => {
            try {
                const notifications = await service.getMyNotifications(req.user!.sub);
                res.json({ notifications });
            } catch (err) {
                logger.error({
                    correlationId: req.correlationId,
                    component: 'notificationRoutes',
                    action: 'GET_MY_ERROR',
                    error: (err as Error).message,
                });
                res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
            }
        },
    );

    // ── GET /notifications/unread-count ───────────────────────────────────────
    router.get(
        '/unread-count',
        validateToken,
        async (req: Request, res: Response): Promise<void> => {
            try {
                const count = await service.getUnreadCount(req.user!.sub);
                res.json({ count });
            } catch (err) {
                logger.error({
                    correlationId: req.correlationId,
                    component: 'notificationRoutes',
                    action: 'UNREAD_COUNT_ERROR',
                    error: (err as Error).message,
                });
                res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
            }
        },
    );

    // ── PATCH /notifications/read-all ─────────────────────────────────────────
    // IMPORTANT: this must be before /:id to prevent route ambiguity
    router.patch(
        '/read-all',
        validateToken,
        async (req: Request, res: Response): Promise<void> => {
            try {
                const count = await service.markAllRead(req.user!.sub);
                res.json({ message: `Marked ${count} notification(s) as read.`, count });
            } catch (err) {
                logger.error({
                    correlationId: req.correlationId,
                    component: 'notificationRoutes',
                    action: 'MARK_ALL_READ_ERROR',
                    error: (err as Error).message,
                });
                res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
            }
        },
    );

    // ── PATCH /notifications/:id/read ─────────────────────────────────────────
    router.patch(
        '/:id/read',
        validateToken,
        async (req: Request, res: Response): Promise<void> => {
            try {
                const notification = await service.markRead(req.params.id, req.user!.sub);
                if (!notification) {
                    res.status(404).json({ error: 'Notification not found', code: 'NOT_FOUND' });
                    return;
                }
                res.json({ notification });
            } catch (err) {
                logger.error({
                    correlationId: req.correlationId,
                    component: 'notificationRoutes',
                    action: 'MARK_READ_ERROR',
                    error: (err as Error).message,
                });
                res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
            }
        },
    );

    return router;
}
