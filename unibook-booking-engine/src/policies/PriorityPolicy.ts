// src/policies/PriorityPolicy.ts
// Priority-based policy — used for LAB resources.
// Research scholars (FACULTY) take precedence over STUDENT bookings
// within a configurable priority window (default: 30 minutes before start).
// Students may still book if no faculty booking exists in that window.

import type { IBookingPolicy } from './IBookingPolicy';
import type { BookingRequest, JWTPayload, PolicyDecision } from '../types';

interface PriorityPolicyConfig {
  facultyWindowMinutes: number;  // default: 30
}

export class PriorityPolicy implements IBookingPolicy {
  private readonly facultyWindowMs: number;

  constructor(config: PriorityPolicyConfig = { facultyWindowMinutes: 30 }) {
    this.facultyWindowMs = config.facultyWindowMinutes * 60 * 1000;
  }

  async validate(
    request: BookingRequest,
    user:    JWTPayload,
  ): Promise<PolicyDecision> {
    const start    = new Date(request.startTime);
    const end      = new Date(request.endTime);
    const durationMs = end.getTime() - start.getTime();

    if (durationMs <= 0) {
      return { allowed: false, reason: 'End time must be after start time.' };
    }

    // Max single booking: 12 hours for labs
    if (durationMs > 12 * 60 * 60 * 1000) {
      return { allowed: false, reason: 'Lab booking duration cannot exceed 12 hours.' };
    }

    // Students cannot book within the faculty priority window of the slot start
    if (user.role === 'STUDENT') {
      const now = Date.now();
      const timeUntilStart = start.getTime() - now;

      if (timeUntilStart > 0 && timeUntilStart < this.facultyWindowMs) {
        return {
          allowed: false,
          reason: `Lab slots within ${this.facultyWindowMs / 60000} minutes of start are reserved for Faculty priority booking.`,
        };
      }
    }

    return { allowed: true };
  }
}
