// src/db.ts
// PostgreSQL connection pool — Singleton pattern (ADR-001)
// Shared across all repository instances via dependency injection.

import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.db.url,
});

// Verify connection on startup
pool.on('connect', () => {
  console.log(JSON.stringify({ level: 'INFO', message: 'PostgreSQL pool: new client connected' }));
});

pool.on('error', (err) => {
  console.error(JSON.stringify({ level: 'ERROR', message: 'PostgreSQL pool error', error: err.message }));
});
