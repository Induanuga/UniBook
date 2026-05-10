// src/config/index.ts
// Resource Catalogue configuration — port 3003 (matches BookingEngine config.services.resourceCatalogueUrl)
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/unibook',
    bookingEngineUrl: process.env.BOOKING_ENGINE_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/unibook_booking',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    // TTL for availability windows (Tactic 2: 30s acceptable staleness, ADR-002)
    availabilityTtlSeconds: parseInt(process.env.REDIS_AVAILABILITY_TTL || '30', 10),
    // TTL for resource metadata (changes rarely — longer TTL acceptable)
    resourceTtlSeconds: parseInt(process.env.REDIS_RESOURCE_TTL || '300', 10),
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'unibook-dev-secret-must-change',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  cors: {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  },

  services: {
    iamUrl:         process.env.IAM_SERVICE_URL          || 'http://localhost:3001',
    bookingEngineUrl: process.env.BOOKING_ENGINE_URL     || 'http://localhost:3002',
  },

  search: {
    // Maximum resources returned per search (NFR-5: protect DB under spike load)
    maxResults: parseInt(process.env.SEARCH_MAX_RESULTS || '50', 10),
    // Availability look-ahead window in days for calendar view (FR-1)
    calendarDays: parseInt(process.env.CALENDAR_DAYS || '30', 10),
  },

  rateLimit: {
    windowMs: 15 * 60 * 1000,
    // Higher limit than IAM — availability browsing is read-heavy (NFR-5)
    max: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  },
};
