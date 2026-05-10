// src/handlers/EscalationHandler.ts
// Chain of Responsibility — Terminal handler (GoF Pattern 14 / Behavioral)
//
// This is the last handler in the chain.
// If reached, it means no other handler could process the request,
// which should not normally happen in a correctly configured chain.
// Logs a warning and returns handled=false so the caller can alert.

import { AbstractApprovalHandler } from './AbstractApprovalHandler';
import type { HandlerContext, HandlerResult } from './IApprovalHandler';
import { logger } from '../utils/logger';

export class EscalationHandler extends AbstractApprovalHandler {
  async handle(context: HandlerContext): Promise<HandlerResult> {
    logger.warn({
      correlationId: context.correlationId,
      component:     'EscalationHandler',
      action:        'UNHANDLED_BOOKING',
      bookingId:     context.bookingId,
      requesterRole: context.requesterRole,
      message:       'No handler in the chain could process this booking role. Check approval_handler_config table.',
    });

    return {
      handled: false,
      message: `No approval handler configured for role: ${context.requesterRole}`,
    };
  }
}
