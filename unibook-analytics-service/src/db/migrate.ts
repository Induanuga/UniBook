// src/db/migrate.ts
// Run once to apply the schema: npm run db:migrate
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function migrate(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('[AnalyticsDB] Schema applied successfully.');
  } catch (err) {
    console.error('[AnalyticsDB] Migration failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
