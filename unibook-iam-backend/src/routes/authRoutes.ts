// src/routes/authRoutes.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import {
  signup,
  login,
  refreshToken,
  logout,
  getMe,
  getAuditLog,
  listUsers,
} from '../controllers/authController';
import { validateToken } from '../middleware/jwtValidator';
import { enforceRole } from '../middleware/roleGuard';

const router = Router();

// ── Rate limiter — brute-force protection on login ──────────────────────────
const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Public routes ────────────────────────────────────────────────────────────
router.post('/signup', signup);
router.post('/login', loginLimiter, login);
router.post('/refresh', refreshToken);

// ── Protected routes (require valid JWT) ─────────────────────────────────────
router.post('/logout', validateToken, logout);
router.get('/me', validateToken, getMe);

// ── Admin-only routes ─────────────────────────────────────────────────────────
router.get('/audit-log', validateToken, enforceRole(['ADMIN', 'IT_STAFF']), getAuditLog);
router.get('/users', validateToken, enforceRole(['ADMIN', 'IT_STAFF']), listUsers);

// ── Internal service-key route — used by Approval Workflow (Subsystem 4) ──────
// Allows listing users by role without a user JWT.
// Protected by shared JWT_SECRET via X-Service-Key header.
router.get(
  '/internal/users',
  async (req, res, next) => {
    const { config } = await import('../config');
    const key = req.headers['x-service-key'] as string;
    if (!key || key !== config.jwt.secret) {
      res.status(401).json({ error: 'Invalid service key', code: 'UNAUTHORIZED' });
      return;
    }
    next();
  },
  listUsers,
);

export default router;
