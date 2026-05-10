// src/middleware/validateToken.ts
// JWT validation middleware — mirrors IAM subsystem pattern.
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { JWTPayload } from '../types';

export function validateToken(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
        return;
    }

    const token = authHeader.slice(7);
    try {
        const payload = jwt.verify(token, config.jwt.secret) as JWTPayload;
        req.user = payload;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    }
}
