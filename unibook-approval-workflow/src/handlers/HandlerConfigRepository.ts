// src/handlers/HandlerConfigRepository.ts
// Reads the approval_handler_config table to drive the Chain of Responsibility.
//
// NFR-3 (Maintainability): Adding a new approval role requires only a new row
// in approval_handler_config — zero code changes anywhere.
//
// Schema: approval_handler_config
//   requester_role  VARCHAR  — who is booking (STUDENT, FACULTY, IT_STAFF, …)
//   approver_level  VARCHAR  — FACULTY or ADMIN
//   handler_order   INTEGER  — chain traversal order (lower = earlier)

import type { Pool } from 'pg';
import { logger } from '../utils/logger';

export interface HandlerConfigRow {
  requesterRole:  string;
  approverLevel:  'FACULTY' | 'ADMIN';
  handlerOrder:   number;
  description:    string | null;
}

export class HandlerConfigRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Load all handler config rows ordered by handler_order ASC.
   * Returns an empty array if the table is missing or empty (graceful degradation).
   */
  async loadAll(): Promise<HandlerConfigRow[]> {
    try {
      const result = await this.db.query<{
        requester_role: string;
        approver_level: string;
        handler_order:  number;
        description:    string | null;
      }>(
        `SELECT requester_role, approver_level, handler_order, description
         FROM approval_handler_config
         ORDER BY handler_order ASC`,
      );

      const rows: HandlerConfigRow[] = result.rows.map(r => ({
        requesterRole: r.requester_role,
        approverLevel: r.approver_level as 'FACULTY' | 'ADMIN',
        handlerOrder:  r.handler_order,
        description:   r.description,
      }));

      logger.info({
        component: 'HandlerConfigRepository',
        action:    'CONFIG_LOADED',
        rowCount:  rows.length,
        roles:     [...new Set(rows.map(r => r.requesterRole))],
      });

      return rows;
    } catch (err) {
      logger.error({
        component: 'HandlerConfigRepository',
        action:    'CONFIG_LOAD_FAILED',
        error:     (err as Error).message,
        message:   'Falling back to empty config — chain will use EscalationHandler for all roles',
      });
      return [];
    }
  }

  /**
   * Get the ordered approver levels for a specific requester role.
   * e.g. STUDENT → ['FACULTY', 'ADMIN']  (faculty first, admin on escalation)
   *      FACULTY → ['ADMIN']
   */
  async getLevelsForRole(requesterRole: string): Promise<Array<'FACULTY' | 'ADMIN'>> {
    const all = await this.loadAll();
    return all
      .filter(r => r.requesterRole === requesterRole)
      .sort((a, b) => a.handlerOrder - b.handlerOrder)
      .map(r => r.approverLevel);
  }
}
