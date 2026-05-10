// src/db/migrate.ts
// Run with: npx ts-node src/db/migrate.ts
import fs from 'fs';
import path from 'path';
import { pool } from './index';

async function migrate(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  try {
    await pool.query(sql);
    console.log('✅ Approval Workflow schema applied successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
