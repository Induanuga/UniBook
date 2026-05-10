// src/policies/IBookingPolicy.ts
// Strategy pattern (ADR-003, Tactic 4, NFR-3).
// BookingService depends ONLY on this interface — never on concrete policy classes.
// Adding a new policy = implement this interface + add one config row.
// Zero changes to BookingService, ConflictDetectionEngine, or BookingFacade.

import type { BookingRequest, JWTPayload, PolicyDecision } from '../types';

export interface IBookingPolicy {
  /**
   * Validate whether the given booking request is permitted for this user.
   * Must be stateless and thread-safe — implementations are singletons.
   */
  validate(
    request: BookingRequest,
    user:    JWTPayload,
  ): Promise<PolicyDecision>;
}
