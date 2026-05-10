// src/handlers/ApprovalHandlerChain.ts
// Chain of Responsibility — Database-driven chain builder (GoF Pattern 14 / Behavioral)
//
// NFR-3 (Maintainability): The handler chain is built from the approval_handler_config
// table at startup. Adding a new approval role requires only a new row in that table —
// zero code changes anywhere in the codebase (ASR-2).
//
// Chain assembly:
//   1. Load all rows from approval_handler_config (via HandlerConfigRepository)
//   2. Determine which concrete handler maps to each approver_level
//   3. Link handlers in handler_order sequence, terminated by EscalationHandler
//
// The chain is built once at startup and reused for all requests.
// To reconfigure: UPDATE approval_handler_config, then restart the service.

import type { IApprovalHandler, HandlerContext, HandlerResult } from './IApprovalHandler';
import { FacultyApprovalHandler }  from './FacultyApprovalHandler';
import { AdminApprovalHandler }    from './AdminApprovalHandler';
import { EscalationHandler }       from './EscalationHandler';
import { HandlerConfigRepository } from './HandlerConfigRepository';
import type { ApprovalRepository } from '../repositories/ApprovalRepository';
import type { Pool }               from 'pg';
import { logger } from '../utils/logger';

export class ApprovalHandlerChain {
  private headHandler: IApprovalHandler;
  private adminHandler: AdminApprovalHandler;

  /**
   * Private constructor — use the static factory `ApprovalHandlerChain.build()`.
   * Accepts a pre-built head handler and the AdminApprovalHandler reference
   * (needed by EscalationScheduler for escalation assignments).
   */
  private constructor(
    headHandler:  IApprovalHandler,
    adminHandler: AdminApprovalHandler,
    configSummary: string,
  ) {
    this.headHandler  = headHandler;
    this.adminHandler = adminHandler;

    logger.info({
      component: 'ApprovalHandlerChain',
      action:    'CHAIN_BUILT',
      message:   configSummary,
    });
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  /**
   * Build the handler chain from the approval_handler_config database table.
   *
   * NFR-3: This is the key method that makes the chain database-driven.
   * The chain is assembled by reading handler config rows and linking
   * concrete handler instances in the configured order.
   *
   * If the config table is empty or unavailable, falls back to the
   * hardcoded default chain (STUDENT→FACULTY→ADMIN, FACULTY→ADMIN).
   */
  static async build(
    approvalRepo: ApprovalRepository,
    db: Pool,
  ): Promise<ApprovalHandlerChain> {
    const configRepo   = new HandlerConfigRepository(db);
    const configRows   = await configRepo.loadAll();

    // Instantiate concrete handlers (singletons shared across all chain paths)
    const facultyHandler    = new FacultyApprovalHandler(approvalRepo);
    const adminHandler      = new AdminApprovalHandler(approvalRepo);
    const escalationHandler = new EscalationHandler();

    // Map approver_level → concrete handler instance
    const levelMap = new Map<string, IApprovalHandler>([
      ['FACULTY', facultyHandler],
      ['ADMIN',   adminHandler],
    ]);

    if (configRows.length === 0) {
      // Graceful fallback: use hardcoded default chain
      logger.warn({
        component: 'ApprovalHandlerChain',
        action:    'USING_DEFAULT_CHAIN',
        message:   'approval_handler_config is empty — using hardcoded default chain',
      });
      facultyHandler.setNext(adminHandler).setNext(escalationHandler);
      return new ApprovalHandlerChain(
        facultyHandler,
        adminHandler,
        'DEFAULT: FacultyHandler → AdminHandler → EscalationHandler',
      );
    }

    // Build the chain from config: link unique handlers in handler_order sequence
    // Deduplicate: each handler appears once in the chain even if multiple roles use it
    const seenLevels = new Set<string>();
    const orderedHandlers: IApprovalHandler[] = [];

    // Sort by handler_order and collect unique levels
    const sortedRows = [...configRows].sort((a, b) => a.handlerOrder - b.handlerOrder);
    for (const row of sortedRows) {
      if (!seenLevels.has(row.approverLevel)) {
        const handler = levelMap.get(row.approverLevel);
        if (handler) {
          orderedHandlers.push(handler);
          seenLevels.add(row.approverLevel);
        } else {
          logger.warn({
            component:     'ApprovalHandlerChain',
            action:        'UNKNOWN_APPROVER_LEVEL',
            approverLevel: row.approverLevel,
            message:       `No handler registered for level "${row.approverLevel}" — skipping`,
          });
        }
      }
    }

    // Always terminate with EscalationHandler
    orderedHandlers.push(escalationHandler);

    // Link the chain
    for (let i = 0; i < orderedHandlers.length - 1; i++) {
      orderedHandlers[i].setNext(orderedHandlers[i + 1]);
    }

    const chainDescription = orderedHandlers
      .map(h => h.constructor.name)
      .join(' → ');

    const configuredRoles = [...new Set(configRows.map(r => r.requesterRole))];

    logger.info({
      component:       'ApprovalHandlerChain',
      action:          'DB_CHAIN_BUILT',
      chain:           chainDescription,
      configuredRoles,
      configRowCount:  configRows.length,
    });

    return new ApprovalHandlerChain(
      orderedHandlers[0],
      adminHandler,
      `DB-DRIVEN: ${chainDescription} | Roles: ${configuredRoles.join(', ')}`,
    );
  }

  /**
   * Synchronous factory for use in tests and contexts without a DB connection.
   * Builds the hardcoded default chain without reading the database.
   *
   * NFR-3: Tests can verify chain behaviour without a live DB.
   */
  static buildDefault(approvalRepo: ApprovalRepository): ApprovalHandlerChain {
    const facultyHandler    = new FacultyApprovalHandler(approvalRepo);
    const adminHandler      = new AdminApprovalHandler(approvalRepo);
    const escalationHandler = new EscalationHandler();

    facultyHandler.setNext(adminHandler).setNext(escalationHandler);

    return new ApprovalHandlerChain(
      facultyHandler,
      adminHandler,
      'DEFAULT (sync): FacultyHandler → AdminHandler → EscalationHandler',
    );
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Process an incoming booking through the chain.
   * The appropriate handler is selected based on requesterRole.
   */
  async handle(context: HandlerContext): Promise<HandlerResult> {
    return this.headHandler.handle(context);
  }

  /**
   * Get the AdminApprovalHandler — used by EscalationScheduler
   * to assign admins to existing faculty-level approvals.
   */
  getAdminHandler(): AdminApprovalHandler {
    return this.adminHandler;
  }
}
