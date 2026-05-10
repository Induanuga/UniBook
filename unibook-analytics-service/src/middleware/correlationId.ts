// src/middleware/correlationId.ts
// Injects or propagates X-Correlation-ID on every request (Tactic 5).
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export function correlationIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  next();
}
