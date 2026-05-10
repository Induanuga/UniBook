// src/middleware/correlationId.ts
// Tactic 5: Structured Logging with Correlation IDs
// Propagates X-Correlation-ID from IAM gateway or generates a new UUID.

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
}
