// src/db/index.ts
// Singleton Pool — shared across all repositories in this process (Singleton pattern).
import { Pool } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.db.url,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[AnalyticsDB] Unexpected pool error:', err.message);
});
