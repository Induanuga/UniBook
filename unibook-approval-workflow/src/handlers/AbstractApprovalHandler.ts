// src/handlers/AbstractApprovalHandler.ts
// Chain of Responsibility — Abstract base handler (GoF Pattern 14 / Behavioral)
//
// Provides the default setNext() implementation and the nextHandler reference.
// All concrete handlers extend this class and only implement handle().

import type { IApprovalHandler, HandlerContext, HandlerResult } from './IApprovalHandler';

export abstract class AbstractApprovalHandler implements IApprovalHandler {
  protected nextHandler: IApprovalHandler | null = null;

  setNext(handler: IApprovalHandler): IApprovalHandler {
    this.nextHandler = handler;
    return handler;  // fluent chain: handler1.setNext(handler2).setNext(handler3)
  }

  abstract handle(context: HandlerContext): Promise<HandlerResult>;
}
