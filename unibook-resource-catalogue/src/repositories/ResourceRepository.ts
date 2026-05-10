// src/repositories/ResourceRepository.ts
// Repository pattern — encapsulates ALL PostgreSQL access for the resources,
// resource_types, and maintenance_windows tables owned by Subsystem 2.
//
// Coupling rule from the spec: Resource Catalogue has READ-ONLY access to the
// bookings table (owned by Subsystem 3). That cross-subsystem read is isolated
// in a dedicated method (findBookingsForResource) with a clear comment so the
// boundary remains visible during code review.

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type {
  Resource,
  ResourceType,
  MaintenanceWindow,
  BookingRecord,
  ResourceSearchFilters,
  CreateResourceRequest,
} from '../types';
import { logger } from '../utils/logger';

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToResource(row: Record<string, unknown>): Resource {
  const typeId = row.type_id as Resource['typeId'];
  return {
    id:           row.id as string,
    name:         row.name as string,
    typeId,
    resourceType: typeId,   // alias consumed by BookingFacade (fetchResourceType)
    location:     row.location as string,
    capacity:     row.capacity as number,
    description:  row.description as string,
    isActive:     row.is_active as boolean,
    amenities:    (row.amenities as string[] | null) ?? [],
    version:      row.version as number,
    createdAt:    new Date(row.created_at as string),
    updatedAt:    new Date(row.updated_at as string),
  };
}

function rowToMaintenanceWindow(row: Record<string, unknown>): MaintenanceWindow {
  return {
    id:         row.id as string,
    resourceId: row.resource_id as string,
    startTime:  new Date(row.start_time as string),
    endTime:    new Date(row.end_time as string),
    reason:     row.reason as string,
    createdBy:  row.created_by as string,
    createdAt:  new Date(row.created_at as string),
  };
}

// ── Repository class ──────────────────────────────────────────────────────────

export class ResourceRepository {
  /**
   * @param db - Resource Catalogue pool (resources, resource_types, maintenance_windows)
   * @param bookingEngineDb - Optional Booking Engine pool for READ-ONLY access to bookings table
   */
  constructor(
    private readonly db: Pool,
    private readonly bookingEngineDb?: Pool,
  ) {}

  // ── Resource CRUD ─────────────────────────────────────────────────────────

  /**
   * Create a new resource. Admin-only (enforced at route level).
   */
  async create(
    params: CreateResourceRequest,
    createdBy: string,
    correlationId?: string,
  ): Promise<Resource> {
    const id = uuidv4();
    const result = await this.db.query(
      `INSERT INTO resources (id, name, type_id, location, capacity, description, amenities)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        params.name,
        params.typeId,
        params.location,
        params.capacity,
        params.description ?? '',
        JSON.stringify(params.amenities ?? []),
      ],
    );

    logger.info({
      correlationId,
      component:  'ResourceRepository',
      action:     'RESOURCE_CREATED',
      resourceId: id,
      createdBy,
    });

    return rowToResource(result.rows[0]);
  }

  /**
   * Find a single resource by ID. Returns null if not found.
   */
  async findById(id: string, correlationId?: string): Promise<Resource | null> {
    const result = await this.db.query(
      'SELECT * FROM resources WHERE id = $1',
      [id],
    );

    if (!result.rows.length) {
      logger.debug({ correlationId, component: 'ResourceRepository', action: 'NOT_FOUND', id });
      return null;
    }

    return rowToResource(result.rows[0]);
  }

  /**
   * Full-text + filter search (FR-1: search by type, location, capacity).
   * Applies all provided filters; falls back to listing active resources if no filters given.
   * NFR-1: query is index-backed (see schema.sql indexes).
   */
  async search(
    filters: ResourceSearchFilters,
    limit: number,
    correlationId?: string,
  ): Promise<Resource[]> {
    const conditions: string[] = ['r.is_active = true'];
    const params: unknown[]    = [];

    if (filters.type) {
      params.push(filters.type);
      conditions.push(`r.type_id = $${params.length}`);
    }

    if (filters.minCapacity !== undefined) {
      params.push(filters.minCapacity);
      conditions.push(`r.capacity >= $${params.length}`);
    }

    if (filters.maxCapacity !== undefined) {
      params.push(filters.maxCapacity);
      conditions.push(`r.capacity <= $${params.length}`);
    }

    if (filters.location) {
      params.push(`%${filters.location.toLowerCase()}%`);
      conditions.push(`LOWER(r.location) LIKE $${params.length}`);
    }

    if (filters.amenities && filters.amenities.length > 0) {
      // JSONB @> containment — resource must have ALL requested amenities
      params.push(JSON.stringify(filters.amenities));
      conditions.push(`r.amenities @> $${params.length}::jsonb`);
    }

    if (filters.isActive !== undefined) {
      params.push(filters.isActive);
      conditions.push(`r.is_active = $${params.length}`);
    }

    params.push(limit);
    const whereClause = conditions.join(' AND ');

    const result = await this.db.query(
      `SELECT r.*
       FROM resources r
       WHERE ${whereClause}
       ORDER BY r.name ASC
       LIMIT $${params.length}`,
      params,
    );

    logger.debug({
      correlationId,
      component: 'ResourceRepository',
      action:    'SEARCH',
      filters,
      resultCount: result.rows.length,
    });

    return result.rows.map(rowToResource);
  }

  /**
   * List all resource types (master lookup).
   */
  async findAllTypes(): Promise<ResourceType[]> {
    const result = await this.db.query(
      'SELECT * FROM resource_types ORDER BY name ASC',
    );
    return result.rows.map((r) => ({
      id:          r.id as ResourceType['id'],
      name:        r.name as string,
      description: r.description as string,
      createdAt:   new Date(r.created_at as string),
    }));
  }

  // ── Maintenance Windows ───────────────────────────────────────────────────

  /**
   * Upsert a maintenance window for a resource.
   * IT Staff and Admin only (enforced at route level).
   * Returns the new window so callers can pass dates to cache invalidation.
   */
  async upsertMaintenanceWindow(
    resourceId: string,
    startTime:  Date,
    endTime:    Date,
    reason:     string,
    createdBy:  string,
    correlationId?: string,
  ): Promise<MaintenanceWindow> {
    const id = uuidv4();
    const result = await this.db.query(
      `INSERT INTO maintenance_windows (id, resource_id, start_time, end_time, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, resourceId, startTime.toISOString(), endTime.toISOString(), reason, createdBy],
    );

    logger.info({
      correlationId,
      component:  'ResourceRepository',
      action:     'MAINTENANCE_CREATED',
      resourceId,
      startTime:  startTime.toISOString(),
      endTime:    endTime.toISOString(),
    });

    return rowToMaintenanceWindow(result.rows[0]);
  }

  /**
   * Get all active maintenance windows for a resource within a date range.
   * Used by AvailabilityCalendarService for slot computation.
   */
  async findMaintenanceWindows(
    resourceId: string,
    from: Date,
    to: Date,
  ): Promise<MaintenanceWindow[]> {
    const result = await this.db.query(
      `SELECT * FROM maintenance_windows
       WHERE resource_id = $1
         AND start_time < $3
         AND end_time   > $2
       ORDER BY start_time ASC`,
      [resourceId, from.toISOString(), to.toISOString()],
    );
    return result.rows.map(rowToMaintenanceWindow);
  }

  // ── Cross-subsystem read (bookings — READ-ONLY) ───────────────────────────
  //
  // Spec §Subsystem 2: "Read-only dependency on bookings table via Repository interface."
  // This is the ONLY place in Subsystem 2 that touches Subsystem 3's table.
  // It uses a dedicated method name to make the boundary visible in diffs.

  /**
   * Fetch bookings for a resource within a time window for availability computation.
   * READ-ONLY — no writes to bookings ever originate from this subsystem.
   */
  async findBookingsForResource(
    resourceId: string,
    from: Date,
    to: Date,
  ): Promise<BookingRecord[]> {
    // Use booking engine pool if available, otherwise fall back to main pool
    const dbConnection = this.bookingEngineDb || this.db;

    const result = await dbConnection.query(
      `SELECT id, resource_id, start_time, end_time, status
       FROM bookings
       WHERE resource_id = $1
         AND status IN ('PENDING', 'APPROVED')
         AND start_time < $3
         AND end_time   > $2
       ORDER BY start_time ASC`,
      [resourceId, from.toISOString(), to.toISOString()],
    );

    return result.rows.map((r) => ({
      id:         r.id as string,
      resourceId: r.resource_id as string,
      startTime:  new Date(r.start_time as string),
      endTime:    new Date(r.end_time as string),
      status:     r.status as BookingRecord['status'],
    }));
  }
}
