// src/db/index.ts
// PostgreSQL connection pool — Singleton pattern (ADR-001)
// Shared across all repository instances in the Booking Engine.

import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.db.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log(JSON.stringify({
    level: 'INFO',
    subsystem: 'BookingEngine',
    message: 'PostgreSQL pool: new client connected',
  }));
});

pool.on('error', (err) => {
  console.error(JSON.stringify({
    level: 'ERROR',
    subsystem: 'BookingEngine',
    message: 'PostgreSQL pool error',
    error: err.message,
  }));
});
