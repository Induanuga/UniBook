// src/server.ts
// UniBook Resource Catalogue — Express server entry point (Subsystem 2).
//
// Port: 3003 (matches config.services.resourceCatalogueUrl in Booking Engine).
//
// Dependency wiring (Singleton pattern):
//   pool (PostgreSQL)  ──► ResourceRepository
//                      ──► AvailabilityCalendarService (via ResourceRepository)
//   redisClient        ──► AvailabilityCacheManager
//                      ──► AvailabilityCalendarService (via AvailabilityCacheManager)
//   ResourceSearchEngine consumes both ResourceRepository + AvailabilityCalendarService.
//
// Integration points:
//   ← IAM (Subsystem 1):      JWT validation middleware (shared JWT_SECRET)
//   → Booking Engine (Sub 3): GET /resources/:id (BookingFacade.fetchResourceType)
//   ← Booking Engine (Sub 3): POST /internal/booking-events (cache invalidation webhook)

import express from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import rateLimit from 'express-rate-limit';

import { config }                    from './config';
import { pool, bookingEnginePool }   from './db';
import { redisClient }               from './cache/RedisClient';
import { AvailabilityCacheManager }  from './cache/AvailabilityCacheManager';
import { ResourceRepository }        from './repositories/ResourceRepository';
import { AvailabilityCalendarService } from './services/AvailabilityCalendarService';
import { ResourceSearchEngine }      from './services/ResourceSearchEngine';
import { createResourceRouter }      from './routes/resourceRoutes';
import { createBookingEventRouter }  from './events/BookingEventListener';
import { correlationIdMiddleware }   from './middleware/correlationId';
import { logger }                    from './utils/logger';

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:         config.cors.frontendUrl,
  credentials:    true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
  exposedHeaders: ['X-Correlation-ID'],
}));
app.use(express.json({ limit: '10kb' }));

// ── Rate limiting (NFR-5: protect under 10x spike) ────────────────────────────
const limiter = rateLimit({
  windowMs:        config.rateLimit.windowMs,
  max:             config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests', code: 'RATE_LIMITED' },
});
app.use('/resources', limiter);

// ── Correlation ID (Tactic 5) ─────────────────────────────────────────────────
app.use(correlationIdMiddleware);

// ── Structured request logging (Tactic 5) ────────────────────────────────────
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
// Singleton pattern: pool and redisClient are shared across all components.
const cacheManager         = new AvailabilityCacheManager(redisClient);
const resourceRepo         = new ResourceRepository(pool, bookingEnginePool);
const availabilityService  = new AvailabilityCalendarService(resourceRepo, cacheManager);
const searchEngine         = new ResourceSearchEngine(resourceRepo, availabilityService);

// ── Routes ─────────────────────────────────────────────────────────────────────

// Public-facing Resource Catalogue API (FR-1 endpoints)
app.use(
  '/resources',
  createResourceRouter({ resourceRepo, availabilityService, searchEngine, cacheManager }),
);

// Internal booking event webhook — cache invalidation (Observer pattern, ADR-004)
// Not rate-limited (internal service-to-service communication)
app.use(
  '/internal/booking-events',
  createBookingEventRouter(cacheManager),
);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    const cacheStats = await cacheManager.getCacheStats();

    res.json({
      status:    'ok',
      subsystem: 'ResourceCatalogue',
      db:        'connected',
      redis:     redisClient.status === 'ready' ? 'connected' : redisClient.status,
      cache:     cacheStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status:    'degraded',
      subsystem: 'ResourceCatalogue',
      error:     (err as Error).message,
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
  // Verify DB connectivity at startup
  await pool.query('SELECT 1');

  app.listen(config.port, () => {
    logger.info({
      component: 'Server',
      message:   `UniBook Resource Catalogue running on port ${config.port}`,
      env:       config.nodeEnv,
      endpoints: {
        resources:     `http://localhost:${config.port}/resources`,
        availability:  `http://localhost:${config.port}/resources/:id/availability?date=YYYY-MM-DD`,
        bookingEvents: `http://localhost:${config.port}/internal/booking-events`,
        health:        `http://localhost:${config.port}/health`,
      },
    });
  });
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info({ component: 'Server', message: 'SIGTERM received — shutting down gracefully' });
  await pool.end();
  await redisClient.quit();
  process.exit(0);
});

start().catch((err) => {
  logger.error({ component: 'Server', message: 'Startup failed', error: (err as Error).message });
  process.exit(1);
});

export default app;
