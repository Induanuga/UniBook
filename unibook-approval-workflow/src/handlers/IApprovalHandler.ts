// src/handlers/IApprovalHandler.ts
// Chain of Responsibility — Handler interface (GoF Pattern 14 / Behavioral)
//
// Each concrete handler either handles a booking approval request or
// passes it to the next handler in the chain.
//
// The chain is: FacultyApprovalHandler → AdminApprovalHandler → EscalationHandler
// Configured by approval_handler_config table — no code changes needed
// when adding new requester roles (NFR-3, ASR-2).

export interface HandlerContext {
  bookingId:       string;
  resourceId:      string;
  requesterId:     string;
  requesterEmail:  string;
  requesterRole:   string; // UserRole from JWT
  requesterName:   string;
  department:      string;
  startTime:       Date;
  endTime:         Date;
  purpose:         string;
  resourceName?:   string;
  correlationId?:  string;
}

export interface HandlerResult {
  handled:      boolean;
  approvalId?:  string;
  level?:       'FACULTY' | 'ADMIN';
  message?:     string;
}

export interface IApprovalHandler {
  /**
   * Attempt to handle the approval request.
   * If handled, return HandlerResult with handled=true.
   * If not applicable, call nextHandler to pass along the chain.
   */
  handle(context: HandlerContext): Promise<HandlerResult>;

  /** Set the next handler in the chain. Returns this for fluent chaining. */
  setNext(handler: IApprovalHandler): IApprovalHandler;
}
