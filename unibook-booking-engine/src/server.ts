// src/server.ts
// UniBook Booking Engine — Express server entry point (Subsystem 3)

import express from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import rateLimit from 'express-rate-limit';

import { config }                 from './config';
import { pool }                   from './db';
import { correlationIdMiddleware } from './middleware/correlationId';
import { BookingPolicyRegistry }  from './policies/BookingPolicyRegistry';
import { BookingService }         from './services/BookingService';
import { BookingFacade }          from './services/BookingFacade';
import { IdempotencyGuard }       from './services/IdempotencyGuard';
import { createBookingRouter }    from './routes/bookingRoutes';
import { logger }                 from './utils/logger';

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:         config.cors.frontendUrl,
  credentials:    true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID', 'Idempotency-Key'],
  exposedHeaders: ['X-Correlation-ID'],
}));
app.use(express.json({ limit: '10kb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      100,
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/bookings', limiter);

// ── Correlation ID ─────────────────────────────────────────────────────────────
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

// ── Dependency wiring ──────────────────────────────────────────────────────────
// Follows Singleton pattern: pool is shared across all repositories (ADR-001).
const policyRegistry   = new BookingPolicyRegistry(pool);
const idempotencyGuard = new IdempotencyGuard(pool);
const bookingService   = new BookingService(pool, policyRegistry);
const bookingFacade    = new BookingFacade(bookingService, idempotencyGuard);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/bookings', createBookingRouter(bookingFacade));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status:    'ok',
      subsystem: 'BookingEngine',
      db:        'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status:    'degraded',
      subsystem: 'BookingEngine',
      db:        'unreachable',
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
  // Load booking policies from DB at startup (Strategy pattern)
  await policyRegistry.load();

  app.listen(config.port, () => {
    logger.info({
      component: 'Server',
      message:   `UniBook Booking Engine running on port ${config.port}`,
      env:       config.nodeEnv,
    });
  });
}

// Graceful shutdown
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
