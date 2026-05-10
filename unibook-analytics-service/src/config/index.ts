// src/config/index.ts
// Analytics Service configuration — loaded from .env
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port:    parseInt(process.env.PORT || '3006', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    url:         process.env.DATABASE_URL ||
      'postgresql://unibook:unibook123@localhost:5432/unibook_analytics',
    approvalUrl: process.env.APPROVAL_DATABASE_URL ||
      'postgresql://unibook:unibook123@localhost:5432/unibook_approval',
    bookingUrl:  process.env.BOOKING_DATABASE_URL ||
      'postgresql://unibook:unibook123@localhost:5432/unibook_booking',
  },

  jwt: {
    secret:    process.env.JWT_SECRET || 'unibook-super-secret-key-change-in-production-min-256-bits',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  services: {
    iamUrl: process.env.IAM_SERVICE_URL || 'http://localhost:3001',
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
  },
};
