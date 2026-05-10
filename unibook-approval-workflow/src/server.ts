// src/server.ts
// UniBook Approval Workflow — Express server entry point (Subsystem 4)
//
// Design Patterns wired here:
//   - Singleton:              pool (shared DB connection)
//   - Chain of Responsibility: ApprovalHandlerChain inside ApprovalService
//   - Repository:             ApprovalRepository inside ApprovalService
//
// Scalability (NFR-5): Stateless — no in-memory approval state. All state in PostgreSQL.
// Security (NFR-2): JWT validation on every protected route via IAM-issued tokens.

import express from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import rateLimit from 'express-rate-limit';

import { config }                  from './config';
import { pool, bookingPool }       from './db';
import { correlationIdMiddleware } from './middleware/correlationId';
import { ApprovalService }         from './services/ApprovalService';
import { EscalationScheduler }     from './services/EscalationScheduler';
import { createApprovalRouter }    from './routes/approvalRoutes';
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
  windowMs:      15 * 60 * 1000,
  max:           config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/approvals', limiter);

// ── Correlation ID (Tactic 5) ─────────────────────────────────────────────────
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

// ── Dependency wiring (Singleton pool shared across repository) ────────────────
const approvalService      = new ApprovalService(pool, bookingPool);
const escalationScheduler  = new EscalationScheduler(approvalService);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/approvals', createApprovalRouter(approvalService));

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status:    'ok',
      subsystem: 'ApprovalWorkflow',
      db:        'connected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status:    'degraded',
      subsystem: 'ApprovalWorkflow',
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
  // NFR-3: Build the DB-driven handler chain before accepting requests.
  // Reads approval_handler_config table — adding a new role = one new row, zero code changes.
  await approvalService.init();

  app.listen(config.port, () => {
    logger.info({
      component: 'Server',
      message:   `UniBook Approval Workflow running on port ${config.port}`,
      env:       config.nodeEnv,
    });
  });

  // Start escalation scheduler (checks every 15 min for overdue faculty approvals)
  escalationScheduler.start();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info({ component: 'Server', message: 'SIGTERM received — shutting down' });
  escalationScheduler.stop();
  await pool.end();
  await bookingPool.end();
  process.exit(0);
});

start().catch((err) => {
  logger.error({ component: 'Server', message: 'Startup failed', error: (err as Error).message });
  process.exit(1);
});

export default app;
