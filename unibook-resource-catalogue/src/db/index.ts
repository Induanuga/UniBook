// src/db/index.ts
// PostgreSQL connection pool — Singleton pattern.
// Shared across ResourceRepository and AvailabilityCalendarService via DI.
// Resource Catalogue has READ-ONLY access to the bookings table (cross-subsystem).

import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Singleton PostgreSQL pool — Resource Catalogue DB.
 * max:20 matches the Booking Engine pool so the shared DB can serve both
 * subsystems at peak (NFR-5 scalability target).
 */
export const pool = new Pool({
  connectionString: config.db.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

/**
 * Cross-subsystem pool — connects to Booking Engine database for READ-ONLY access to bookings.
 * Used by ResourceRepository.findBookingsForResource() to calculate availability.
 */
export const bookingEnginePool = new Pool({
  connectionString: config.db.bookingEngineUrl,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  logger.info({ component: 'DB', message: 'PostgreSQL pool: new client connected' });
});

pool.on('error', (err) => {
  logger.error({ component: 'DB', message: 'PostgreSQL pool error', error: err.message });
});

bookingEnginePool.on('connect', () => {
  logger.info({ component: 'DB', message: 'Booking Engine pool: new client connected' });
});

bookingEnginePool.on('error', (err) => {
  logger.error({ component: 'DB', message: 'Booking Engine pool error', error: err.message });
});
