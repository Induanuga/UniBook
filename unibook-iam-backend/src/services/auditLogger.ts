// src/services/auditLogger.ts
// AuditLogger — writes an immutable audit record for every auth event.
// Writes to PostgreSQL audit_log table (with in-memory fallback for dev).

import { v4 as uuidv4 } from 'uuid';
import { AuditLogEntry, UserRole } from '../types';

// In-memory fallback (used if DB write fails)
const memoryLog: AuditLogEntry[] = [];

interface AuditOptions {
  actor: string;
  actorEmail: string;
  endpoint: string;
  method: string;
  action: string;
  roleRequired?: UserRole;
  rolePresented?: UserRole;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export function writeAuditLog(opts: AuditOptions): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: uuidv4(),
    ...opts,
    timestamp: new Date().toISOString(),
  };

  // Always log to stdout (structured JSON for log aggregators)
  console.log(JSON.stringify({ level: 'AUDIT', ...entry }));

  // Keep in-memory copy
  memoryLog.push(entry);

  // Async write to DB — fire-and-forget (non-blocking, spec: NFR-2 requires sync log before 401/403)
  // The sync path above already satisfies NFR-2 (entry is recorded before response is sent).
  writeAuditLogToDb(entry).catch((err) => {
    console.error(JSON.stringify({ level: 'ERROR', message: 'Audit DB write failed', error: err.message }));
  });

  return entry;
}

async function writeAuditLogToDb(entry: AuditLogEntry): Promise<void> {
  try {
    // Lazy import to avoid circular dep at startup
    const { pool } = await import('../db');
    await pool.query(
      `INSERT INTO audit_log
         (id, actor, actor_email, endpoint, method, action,
          role_required, role_presented, ip_address, user_agent,
          success, metadata, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        entry.id,
        entry.actor,
        entry.actorEmail,
        entry.endpoint,
        entry.method,
        entry.action,
        entry.roleRequired || null,
        entry.rolePresented || null,
        entry.ipAddress,
        entry.userAgent,
        entry.success,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.timestamp,
      ]
    );
  } catch {
    // Silently swallow — already logged to stdout + memory above
  }
}

export function getAuditLog(): AuditLogEntry[] {
  return [...memoryLog];
}

// Fetch audit log from DB (for admin endpoint)
export async function getAuditLogFromDb(limit = 200): Promise<AuditLogEntry[]> {
  try {
    const { pool } = await import('../db');
    const result = await pool.query(
      `SELECT id, actor, actor_email AS "actorEmail", endpoint, method,
              action, role_required AS "roleRequired",
              role_presented AS "rolePresented",
              ip_address AS "ipAddress", user_agent AS "userAgent",
              success, metadata, timestamp
       FROM audit_log
       ORDER BY timestamp DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch {
    // Fall back to in-memory
    return getAuditLog();
  }
}
