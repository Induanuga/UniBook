// src/middleware/roleGuard.ts
// Role-based access control — must be used AFTER validateToken (NFR-2).

import { Request, Response, NextFunction } from 'express';
import type { UserRole } from '../types';
import { logger } from '../utils/logger';

export function enforceRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn({
        correlationId: req.correlationId,
        action: 'ACCESS_DENIED_INSUFFICIENT_ROLE',
        userId: req.user.sub,
        rolePresented: req.user.role,
        rolesRequired: allowedRoles,
        path: req.path,
      });
      res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
        code: 'INSUFFICIENT_ROLE',
        yourRole: req.user.role,
      });
      return;
    }

    next();
  };
}
