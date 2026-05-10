// src/middleware/correlationId.ts
// CorrelationIDMiddleware — injects a unique ID into every request for cross-subsystem tracing.
// Spec Tactic 5: Structured Logging with Correlation IDs

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
}
