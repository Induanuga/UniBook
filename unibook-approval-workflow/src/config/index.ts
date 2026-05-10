// src/config/index.ts
// Approval Workflow subsystem configuration — loaded from .env
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    // Approval workflow's own database
    url: process.env.DATABASE_URL || 'postgresql://unibook:unibook123@localhost:5432/unibook_approval',
    // Read-only access to booking engine database for booking details
    bookingEngineUrl: process.env.BOOKING_ENGINE_DATABASE_URL || 'postgresql://unibook:unibook123@localhost:5432/unibook_booking',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'unibook-dev-secret-must-change',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  services: {
    iamUrl: process.env.IAM_SERVICE_URL || 'http://localhost:3001',
    bookingEngineUrl: process.env.BOOKING_ENGINE_URL || 'http://localhost:3002',
    resourceCatalogueUrl: process.env.RESOURCE_CATALOGUE_URL || 'http://localhost:3003',
    notificationServiceUrl: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3005',
    analyticsServiceUrl: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3006',
  },

  escalation: {
    // Hours before an unanswered faculty approval escalates to admins (FR-5)
    escalationHours: parseInt(process.env.ESCALATION_HOURS || '24', 10),
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  },
};
