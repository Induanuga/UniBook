// src/policies/FIFOPolicy.ts
// First-come-first-served policy — used for SEMINAR_ROOM and EQUIPMENT.
// Allows any authenticated user with a valid request if the slot is free.

import type { IBookingPolicy } from './IBookingPolicy';
import type { BookingRequest, JWTPayload, PolicyDecision } from '../types';

export class FIFOPolicy implements IBookingPolicy {
  async validate(
    request: BookingRequest,
    _user:   JWTPayload,
  ): Promise<PolicyDecision> {
    const durationMs =
      new Date(request.endTime).getTime() - new Date(request.startTime).getTime();

    // Max single booking: 8 hours
    if (durationMs > 8 * 60 * 60 * 1000) {
      return { allowed: false, reason: 'Booking duration cannot exceed 8 hours.' };
    }

    if (durationMs <= 0) {
      return { allowed: false, reason: 'End time must be after start time.' };
    }

    return { allowed: true };
  }
}
