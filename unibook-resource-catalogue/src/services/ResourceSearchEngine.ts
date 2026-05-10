// src/services/ResourceSearchEngine.ts
// ResourceSearchEngine — implements the Specification pattern (one of the 23 GoF-adjacent
// patterns, closely related to Template Method and Strategy).
//
// Each filter criterion is a Specification object with a single isSatisfiedBy() method.
// Specifications compose via and() / or() / not() — adding a new filter criterion
// requires zero changes to any existing code (Open-Closed Principle, NFR-3).
//
// At runtime the engine evaluates all active specifications and delegates the actual
// DB query to ResourceRepository with the composed filter set.

import type { Resource, ResourceSearchFilters, ResourceWithAvailability } from '../types';
import type { ResourceRepository } from '../repositories/ResourceRepository';
import type { AvailabilityCalendarService } from './AvailabilityCalendarService';
import { logger } from '../utils/logger';
import { config } from '../config';

// ── Specification interface ──────────────────────────────────────────────────

interface ISpecification<T> {
  isSatisfiedBy(candidate: T): boolean;
}

// ── Concrete Specifications ──────────────────────────────────────────────────

class TypeSpecification implements ISpecification<Resource> {
  constructor(private readonly type: string) {}
  isSatisfiedBy(r: Resource): boolean { return r.typeId === this.type; }
}

class CapacitySpecification implements ISpecification<Resource> {
  constructor(
    private readonly min: number,
    private readonly max: number,
  ) {}
  isSatisfiedBy(r: Resource): boolean {
    return r.capacity >= this.min && r.capacity <= this.max;
  }
}

class LocationSpecification implements ISpecification<Resource> {
  constructor(private readonly location: string) {}
  isSatisfiedBy(r: Resource): boolean {
    return r.location.toLowerCase().includes(this.location.toLowerCase());
  }
}

class AmenitiesSpecification implements ISpecification<Resource> {
  constructor(private readonly required: string[]) {}
  isSatisfiedBy(r: Resource): boolean {
    return this.required.every((a) => r.amenities.includes(a));
  }
}

class ActiveSpecification implements ISpecification<Resource> {
  isSatisfiedBy(r: Resource): boolean { return r.isActive; }
}

// Composite Specification — composes multiple specs with AND logic
class AndSpecification<T> implements ISpecification<T> {
  constructor(private readonly specs: ISpecification<T>[]) {}
  isSatisfiedBy(candidate: T): boolean {
    return this.specs.every((s) => s.isSatisfiedBy(candidate));
  }
}

// ── Search Engine ────────────────────────────────────────────────────────────

export class ResourceSearchEngine {
  constructor(
    private readonly resourceRepo:  ResourceRepository,
    private readonly availabilityService: AvailabilityCalendarService,
  ) {}

  /**
   * Search resources applying the Specification pattern for in-memory post-filtering
   * after the DB query returns results.
   *
   * The DB query handles primary filters (type, capacity, location, amenities) via
   * index-backed SQL for performance (NFR-1). The Specification layer adds
   * composable secondary filtering and ensures no invalid data leaks through.
   *
   * If `filters.date` is supplied, availability summaries are attached to each result
   * so the frontend can show free slot counts in the search grid (FR-1).
   */
  async search(
    filters: ResourceSearchFilters,
    correlationId?: string,
  ): Promise<ResourceWithAvailability[]> {
    const t0 = Date.now();

    // ── 1. DB query (primary filter — index-backed) ───────────────────────
    const dbResults = await this.resourceRepo.search(
      filters,
      config.search.maxResults,
      correlationId,
    );

    // ── 2. Build Specification composite from active filters ──────────────
    const specs: ISpecification<Resource>[] = [new ActiveSpecification()];

    if (filters.type)                         specs.push(new TypeSpecification(filters.type));
    if (filters.minCapacity !== undefined ||
        filters.maxCapacity !== undefined) {
      specs.push(new CapacitySpecification(
        filters.minCapacity ?? 0,
        filters.maxCapacity ?? Number.MAX_SAFE_INTEGER,
      ));
    }
    if (filters.location)                      specs.push(new LocationSpecification(filters.location));
    if (filters.amenities?.length)             specs.push(new AmenitiesSpecification(filters.amenities));

    const composite = new AndSpecification(specs);

    // ── 3. Post-filter with Specification (double-checks DB results) ──────
    const filtered = dbResults.filter((r) => composite.isSatisfiedBy(r));

    // ── 4. Optionally attach availability summary if date was given ────────
    let results: ResourceWithAvailability[] = filtered;

    if (filters.date) {
      results = await Promise.all(
        filtered.map(async (resource) => {
          try {
            const calendar = await this.availabilityService.getAvailability(
              resource.id,
              filters.date!,
              correlationId,
            );
            const freeSlots  = calendar.slots.filter((s) => s.status === 'FREE').length;
            const totalSlots = calendar.slots.length;

            return {
              ...resource,
              availabilitySummary: {
                date:            filters.date!,
                totalSlots,
                freeSlots,
                hasAvailability: freeSlots > 0,
              },
            };
          } catch {
            return resource; // degrade gracefully if availability fetch fails
          }
        }),
      );
    }

    logger.info({
      correlationId,
      component:   'ResourceSearchEngine',
      action:      'SEARCH_COMPLETE',
      dbResults:   dbResults.length,
      filtered:    filtered.length,
      withDate:    !!filters.date,
      elapsedMs:   Date.now() - t0,
    });

    return results;
  }
}
