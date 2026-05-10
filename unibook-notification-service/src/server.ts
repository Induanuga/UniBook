// src/server.ts
// UniBook Notification Service — Express server entry point (Subsystem 5)
//
// Design Patterns wired here:
//   - Singleton:  pool (shared DB connection)
//   - Strategy:   NotificationChannelRegistry inside NotificationService
//   - Observer:   Approval Workflow POSTs events to /notifications/internal/event
//   - Repository: NotificationRepository inside NotificationService
//
// Security (NFR-2): JWT validation on every user-facing route.
// Scalability (NFR-5): Stateless — no in-memory notification state. All state in PostgreSQL.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import { pool } from './db';
import { correlationIdMiddleware } from './middleware/correlationId';
import { NotificationService } from './services/NotificationService';
import { createNotificationRouter } from './routes/notificationRoutes';
import { logger } from './utils/logger';

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
    origin: config.cors.frontendUrl,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Service-Key'],
    exposedHeaders: ['X-Correlation-ID'],
}));
app.use(express.json({ limit: '10kb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/notifications', limiter);

// ── Correlation ID ────────────────────────────────────────────────────────────
app.use(correlationIdMiddleware);

// ── Structured request logging ────────────────────────────────────────────────
app.use((req, _res, next) => {
    logger.info({
        correlationId: req.correlationId,
        component: 'HTTP',
        method: req.method,
        path: req.path,
        ip: req.ip,
    });
    next();
});

// ── Dependency wiring ──────────────────────────────────────────────────────────
const notificationService = new NotificationService(pool);

// NFR-4: start the retry queue background poller
notificationService.retryQueue.start();

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/notifications', createNotificationRouter(notificationService));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'ok',
            subsystem: 'NotificationService',
            db: 'connected',
            timestamp: new Date().toISOString(),
        });
    } catch {
        res.status(503).json({
            status: 'degraded',
            subsystem: 'NotificationService',
            db: 'unreachable',
            timestamp: new Date().toISOString(),
        });
    }
});

// ── 404 handler ────────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ component: 'GlobalErrorHandler', error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
    app.listen(config.port, () => {
        logger.info({
            component: 'Server',
            message: `UniBook Notification Service running on port ${config.port}`,
            env: config.nodeEnv,
        });
    });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info({ component: 'Server', message: 'SIGTERM received — shutting down' });
    notificationService.retryQueue.stop();
    await pool.end();
    process.exit(0);
});

start().catch((err) => {
    logger.error({ component: 'Server', message: 'Startup failed', error: (err as Error).message });
    process.exit(1);
});

export default app;
