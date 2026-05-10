// src/config/index.ts
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/unibook',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'unibook-super-secret-key-change-in-production-min-256-bits',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  services: {
    iamUrl:               process.env.IAM_SERVICE_URL            || 'http://localhost:3001',
    resourceCatalogueUrl: process.env.RESOURCE_CATALOGUE_URL     || 'http://localhost:3003',
    approvalWorkflowUrl:  process.env.APPROVAL_WORKFLOW_URL      || 'http://localhost:3004',
    analyticsServiceUrl:  process.env.ANALYTICS_SERVICE_URL      || 'http://localhost:3006',
  },

  idempotency: {
    windowHours: 24,
  },

  conflict: {
    // How many next-slot suggestions to return on conflict (FR-4)
    suggestionCount: 3,
    // Look ahead window for slot suggestions (FR-4: within 7 days)
    lookAheadDays: 7,
  },
};
