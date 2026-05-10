// src/middleware/roleGuard.ts
// RoleGuard middleware — enforces role-based access control on protected routes.
// Spec NFR-2: All privilege violations logged with actor, timestamp, attempted resource.

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';
import { writeAuditLog } from '../services/auditLogger';

/**
 * Middleware factory — enforces that the authenticated user has one of the allowed roles.
 * Must be used AFTER validateToken middleware.
 *
 * Usage: router.get('/admin-only', validateToken, enforceRole(['ADMIN']), handler)
 */
export function enforceRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated', code: 'NOT_AUTHENTICATED' });
      return;
    }

    const hasRole = allowedRoles.includes(req.user.role);

    if (!hasRole) {
      // Spec: All privilege violations logged synchronously before returning 403
      writeAuditLog({
        actor: req.user.sub,
        actorEmail: req.user.email,
        endpoint: req.path,
        method: req.method,
        action: 'ACCESS_DENIED_INSUFFICIENT_ROLE',
        roleRequired: allowedRoles[0],   // Log the primary required role
        rolePresented: req.user.role,
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        success: false,
        metadata: { allowedRoles },
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
