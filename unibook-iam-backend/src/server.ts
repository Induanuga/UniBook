// src/server.ts
// UniBook IAM Subsystem — Express server entry point

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { correlationIdMiddleware } from './middleware/correlationId';
import authRoutes from './routes/authRoutes';
import casRoutes from './routes/casRoutes';

const app = express();

// Security headers
app.use(helmet());

// CORS — allow only the frontend origin
app.use(
  cors({
    origin: config.cors.frontendUrl,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
    exposedHeaders: ['X-Correlation-ID'],
  })
);

// Body parsing
app.use(express.json({ limit: '10kb' }));

// Inject correlation ID on every request
app.use(correlationIdMiddleware);

// Structured request logging
app.use((req, _res, next) => {
  console.log(
    JSON.stringify({
      level: 'INFO',
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      timestamp: new Date().toISOString(),
    })
  );
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
// Email/password IAM routes
app.use('/auth', authRoutes);

// CAS SSO routes  (/auth/cas/login  and  /auth/cas/callback)
app.use('/auth/cas', casRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    subsystem: 'IAM',
    cas: {
      serverUrl: config.cas.serverUrl,
      serviceUrl: config.cas.serviceUrl,
    },
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(JSON.stringify({ level: 'ERROR', message: err.message, stack: err.stack }));
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: 'INFO',
      message: `UniBook IAM Subsystem running on port ${config.port}`,
      cas: `CAS login → ${config.cas.serverUrl}/login`,
      env: config.nodeEnv,
      timestamp: new Date().toISOString(),
    })
  );
});

export default app;
