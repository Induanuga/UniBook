// src/policies/QuotaPolicy.ts
// Quota-limited policy — used for GPU_CLUSTER resources.
// Enforces a monthly hour quota per department, checked against quota_usage table.

import { Pool } from 'pg';
import type { IBookingPolicy } from './IBookingPolicy';
import type { BookingRequest, JWTPayload, PolicyDecision } from '../types';
import { logger } from '../utils/logger';

interface QuotaPolicyConfig {
  monthlyHoursPerDept: number;  // default: 40
}

export class QuotaPolicy implements IBookingPolicy {
  private readonly monthlyMinutesPerDept: number;

  constructor(
    private readonly db: Pool,
    config: QuotaPolicyConfig = { monthlyHoursPerDept: 40 },
  ) {
    this.monthlyMinutesPerDept = config.monthlyHoursPerDept * 60;
  }

  async validate(
    request: BookingRequest,
    user:    JWTPayload,
  ): Promise<PolicyDecision> {
    const start      = new Date(request.startTime);
    const end        = new Date(request.endTime);
    const durationMs = end.getTime() - start.getTime();

    if (durationMs <= 0) {
      return { allowed: false, reason: 'End time must be after start time.' };
    }

    const requestedMinutes = durationMs / 60000;
    const yearMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;

    // Look up current month's usage for this department
    const result = await this.db.query(
      `SELECT used_minutes FROM quota_usage
       WHERE department = $1
         AND resource_type = 'GPU_CLUSTER'
         AND year_month = $2`,
      [user.department, yearMonth],
    );

    const usedMinutes = result.rows.length
      ? (result.rows[0].used_minutes as number)
      : 0;

    const remaining = this.monthlyMinutesPerDept - usedMinutes;

    logger.info({
      component:     'QuotaPolicy',
      department:    user.department,
      yearMonth,
      usedMinutes,
      requestedMinutes,
      remaining,
    });

    if (requestedMinutes > remaining) {
      return {
        allowed: false,
        reason: `Department quota exceeded. ${remaining} minutes remaining this month (${this.monthlyMinutesPerDept / 60}h total).`,
      };
    }

    return { allowed: true };
  }

  /** Called by BookingService after a booking is confirmed to increment usage. */
  async incrementUsage(
    department:   string,
    startTime:    Date,
    endTime:      Date,
  ): Promise<void> {
    const minutes   = (endTime.getTime() - startTime.getTime()) / 60000;
    const yearMonth = `${startTime.getFullYear()}-${String(startTime.getMonth() + 1).padStart(2, '0')}`;

    await this.db.query(
      `INSERT INTO quota_usage (department, resource_type, year_month, used_minutes)
       VALUES ($1, 'GPU_CLUSTER', $2, $3)
       ON CONFLICT (department, resource_type, year_month)
       DO UPDATE SET used_minutes = quota_usage.used_minutes + $3`,
      [department, yearMonth, Math.ceil(minutes)],
    );
  }
}
