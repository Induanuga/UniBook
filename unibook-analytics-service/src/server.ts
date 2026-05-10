// src/server.ts
// UniBook Analytics & Reporting Service — Express server entry point (Subsystem 6)
//
// Design Patterns wired here:
//   - Singleton:   pool (shared DB connection — Singleton pattern)
//   - Facade:      AnalyticsService (single entry point for all analytics operations)
//   - Observer:    Booking Engine / Approval Workflow POST events to /analytics/internal/event
//   - Repository:  AnalyticsRepository inside AnalyticsService
//
// Security (NFR-2): JWT + ADMIN role enforced on every user-facing route.
// Performance (NFR-1): Heatmap queries read from materialised snapshots only.
// Scalability (NFR-5): Stateless — all state in PostgreSQL.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config }                  from './config';
import { pool }                    from './db';
import { correlationIdMiddleware } from './middleware/correlationId';
import { AnalyticsService }        from './services/AnalyticsService';
import { createAnalyticsRouter }   from './routes/analyticsRoutes';
import { runStartupBackfill }      from './services/StartupBackfill';
import { logger }                  from './utils/logger';

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:         config.cors.frontendUrl,
  credentials:    true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'X-Service-Key'],
  exposedHeaders: ['X-Correlation-ID'],
}));
app.use(express.json({ limit: '10kb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:  false,
});
app.use('/analytics', limiter);

// ── Correlation ID ────────────────────────────────────────────────────────────
app.use(correlationIdMiddleware);

// ── Structured request logging ────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info({
    correlationId: req.correlationId,
    component:     'HTTP',
    method:        req.method,
    path:          req.path,
    ip:            req.ip,
  });
  next();
});

// ── Dependency wiring ─────────────────────────────────────────────────────────
const analyticsService = new AnalyticsService(pool);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/analytics', createAnalyticsRouter(analyticsService));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status:    'ok',
      subsystem: 'AnalyticsService',
      db:        'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status:    'degraded',
      subsystem: 'AnalyticsService',
      db:        'unreachable',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ component: 'GlobalErrorHandler', error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  app.listen(config.port, () => {
    logger.info({
      component: 'Server',
      message:   `UniBook Analytics Service running on port ${config.port}`,
      env:       config.nodeEnv,
    });
  });

  // Auto-backfill from approval/booking DBs on every startup (idempotent)
  // Runs after server is listening so health checks pass immediately
  setImmediate(() => runStartupBackfill(pool));
}

process.on('SIGTERM', async () => {
  logger.info({ component: 'Server', message: 'SIGTERM received — shutting down' });
  await pool.end();
  process.exit(0);
});

start().catch((err) => {
  logger.error({ component: 'Server', message: 'Startup failed', error: (err as Error).message });
  process.exit(1);
});

export default app;
