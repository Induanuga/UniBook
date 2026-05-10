// src/db/index.ts
// PostgreSQL connection pools — Singleton pattern.
// Two pools:
//   1. pool       → unibook_approval (owned tables)
//   2. bookingPool → unibook_booking (read-only for booking details)

import { Pool } from 'pg';
import { config } from '../config';

// ── Primary pool: Approval Workflow's own database ──────────────────────────
export const pool = new Pool({
  connectionString: config.db.url,
  max:                   20,
  idleTimeoutMillis:     30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log(JSON.stringify({
    level: 'INFO',
    subsystem: 'ApprovalWorkflow',
    message: 'PostgreSQL pool (approval): new client connected',
  }));
});

pool.on('error', (err) => {
  console.error(JSON.stringify({
    level:     'ERROR',
    subsystem: 'ApprovalWorkflow',
    message:   'PostgreSQL pool (approval) error',
    error:     err.message,
  }));
});

// ── Secondary pool: Booking Engine database (read-only) ─────────────────────
export const bookingPool = new Pool({
  connectionString: config.db.bookingEngineUrl,
  max:                   5,
  idleTimeoutMillis:     30000,
  connectionTimeoutMillis: 2000,
});

bookingPool.on('error', (err) => {
  console.error(JSON.stringify({
    level:     'ERROR',
    subsystem: 'ApprovalWorkflow',
    message:   'PostgreSQL pool (booking, read-only) error',
    error:     err.message,
  }));
});
