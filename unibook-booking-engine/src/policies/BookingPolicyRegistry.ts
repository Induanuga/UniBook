// src/policies/BookingPolicyRegistry.ts
// Strategy pattern Context (ADR-003, NFR-3).
// Maps resource_type → IBookingPolicy at startup from the booking_policies config table.
// BookingService calls getPolicyFor(resourceType) — it has ZERO knowledge of which
// concrete policy runs. Adding a new policy = 1 class + 1 DB config row.

import { Pool } from 'pg';
import type { IBookingPolicy } from './IBookingPolicy';
import { FIFOPolicy }     from './FIFOPolicy';
import { PriorityPolicy } from './PriorityPolicy';
import { QuotaPolicy }    from './QuotaPolicy';
import { logger } from '../utils/logger';

export class BookingPolicyRegistry {
  private readonly policyMap = new Map<string, IBookingPolicy>();

  constructor(private readonly db: Pool) {}

  /**
   * Load policy mappings from booking_policies config table.
   * Called once at server startup.
   */
  async load(): Promise<void> {
    const result = await this.db.query(
      'SELECT resource_type, policy_name, policy_config FROM booking_policies',
    );

    for (const row of result.rows) {
      const resourceType: string = row.resource_type as string;
      const policyName:   string = row.policy_name as string;
      const policyConfig: Record<string, unknown> = row.policy_config as Record<string, unknown>;

      const policy = this.buildPolicy(policyName, policyConfig);
      if (policy) {
        this.policyMap.set(resourceType, policy);
        logger.info({
          component:    'BookingPolicyRegistry',
          action:       'POLICY_REGISTERED',
          resourceType,
          policyName,
        });
      }
    }
  }

  /**
   * Register a policy programmatically (used in tests / dynamic registration).
   */
  register(resourceType: string, policy: IBookingPolicy): void {
    this.policyMap.set(resourceType, policy);
  }

  /**
   * Returns the policy for the given resource type.
   * Falls back to FIFOPolicy if no mapping exists.
   */
  getPolicyFor(resourceType: string): IBookingPolicy {
    const policy = this.policyMap.get(resourceType);
    if (!policy) {
      logger.warn({
        component:    'BookingPolicyRegistry',
        action:       'POLICY_NOT_FOUND_FALLBACK',
        resourceType,
      });
      return new FIFOPolicy();
    }
    return policy;
  }

  private buildPolicy(
    name:   string,
    config: Record<string, unknown>,
  ): IBookingPolicy | null {
    switch (name) {
      case 'FIFO':
        return new FIFOPolicy();
      case 'PRIORITY':
        return new PriorityPolicy({
          facultyWindowMinutes: (config.facultyWindowMinutes as number) ?? 30,
        });
      case 'QUOTA':
        return new QuotaPolicy(this.db, {
          monthlyHoursPerDept: (config.monthlyHoursPerDept as number) ?? 40,
        });
      default:
        logger.warn({
          component: 'BookingPolicyRegistry',
          action:    'UNKNOWN_POLICY',
          name,
        });
        return null;
    }
  }
}
