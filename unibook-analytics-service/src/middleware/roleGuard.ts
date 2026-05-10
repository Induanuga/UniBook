// src/middleware/roleGuard.ts
// Role-based access guard — mirrors other subsystems (NFR-2).
import { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../types';

export function enforceRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role', code: 'INSUFFICIENT_ROLE' });
      return;
    }
    next();
  };
}
