// src/routes/resourceRoutes.ts
// Resource Catalogue REST API — Subsystem 2.
//
// FR-1:  GET  /resources                       — search / list with filters
// FR-1:  GET  /resources/types                 — list resource types
// FR-1:  GET  /resources/:id                   — single resource (also called by BookingFacade)
// FR-1:  GET  /resources/:id/availability      — availability calendar for a date
//        POST /resources                       — create resource (ADMIN only)
// FR-1:  PUT  /resources/:id/maintenance       — schedule maintenance window (ADMIN, IT_STAFF)

import { Router, Request, Response } from 'express';
import { validateToken }    from '../middleware/validateToken';
import { enforceRole }      from '../middleware/roleGuard';
import type { ResourceSearchFilters, CreateResourceRequest, UpdateMaintenanceRequest, ResourceTypeId } from '../types';
import type { ResourceRepository }       from '../repositories/ResourceRepository';
import type { AvailabilityCalendarService } from '../services/AvailabilityCalendarService';
import type { ResourceSearchEngine }     from '../services/ResourceSearchEngine';
import type { AvailabilityCacheManager } from '../cache/AvailabilityCacheManager';
import { logger } from '../utils/logger';

interface RouterDeps {
  resourceRepo:        ResourceRepository;
  availabilityService: AvailabilityCalendarService;
  searchEngine:        ResourceSearchEngine;
  cacheManager:        AvailabilityCacheManager;
}

export function createResourceRouter(deps: RouterDeps): Router {
  const { resourceRepo, availabilityService, searchEngine, cacheManager } = deps;
  const router = Router();

  // ── GET /resources/types ───────────────────────────────────────────────────
  // List all resource types — public read (still requires auth for RBAC uniformity).
  router.get(
    '/types',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const types = await resourceRepo.findAllTypes();
        res.json({ types });
      } catch (err) {
        logger.error({ correlationId: req.correlationId, component: 'resourceRoutes', action: 'GET_TYPES_ERROR', error: (err as Error).message });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /resources ─────────────────────────────────────────────────────────
  // FR-1: Search resource catalogue.
  // Supports query params: type, location, minCapacity, maxCapacity, amenities, date, isActive.
  router.get(
    '/',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.correlationId;

      try {
        const filters: ResourceSearchFilters = {};

        if (req.query.type)        filters.type        = req.query.type as ResourceTypeId;
        if (req.query.location)    filters.location    = req.query.location as string;
        if (req.query.minCapacity) filters.minCapacity = parseInt(req.query.minCapacity as string, 10);
        if (req.query.maxCapacity) filters.maxCapacity = parseInt(req.query.maxCapacity as string, 10);
        if (req.query.date)        filters.date        = req.query.date as string;

        // amenities=projector,whiteboard → split into array
        if (req.query.amenities) {
          filters.amenities = (req.query.amenities as string).split(',').map((a) => a.trim()).filter(Boolean);
        }

        // Validate date format if provided
        if (filters.date && !/^\d{4}-\d{2}-\d{2}$/.test(filters.date)) {
          res.status(400).json({ error: 'date must be YYYY-MM-DD', code: 'VALIDATION_ERROR' });
          return;
        }

        const t0 = Date.now();
        const resources = await searchEngine.search(filters, correlationId);
        const elapsed   = Date.now() - t0;

        // NFR-1 P95 monitoring: warn if search exceeded 500ms
        if (elapsed > 500) {
          logger.warn({
            correlationId,
            component: 'resourceRoutes',
            action:    'SEARCH_LATENCY_BREACH',
            elapsedMs: elapsed,
            threshold: 500,
          });
        }

        res.json({
          resources,
          total:   resources.length,
          filters,
          _meta: { elapsedMs: elapsed },
        });
      } catch (err) {
        logger.error({ correlationId, component: 'resourceRoutes', action: 'SEARCH_ERROR', error: (err as Error).message });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /resources/:id ─────────────────────────────────────────────────────
  // Returns a single resource. This is the endpoint called by BookingFacade
  // (Booking Engine Subsystem 3) to resolve resourceType for policy selection.
  // Response includes `resourceType` field (alias for typeId) for that purpose.
  router.get(
    '/:id',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.correlationId;
      const { id } = req.params;

      try {
        // Cache-first (resource metadata changes rarely — 300s TTL)
        const cached = await cacheManager.getResource(id, correlationId);
        if (cached) {
          res.json(cached);
          return;
        }

        const resource = await resourceRepo.findById(id, correlationId);

        if (!resource) {
          res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
          return;
        }

        // Populate cache for future requests
        void cacheManager.setResource(id, resource as unknown as Record<string, unknown>, correlationId);

        res.json(resource);
      } catch (err) {
        logger.error({ correlationId, component: 'resourceRoutes', action: 'GET_RESOURCE_ERROR', error: (err as Error).message });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── GET /resources/:id/availability ───────────────────────────────────────
  // FR-1: Live availability calendar at 15-minute granularity.
  // Served primarily from Redis cache (Tactic 2, ADR-002).
  // Query param: date (YYYY-MM-DD, required).
  router.get(
    '/:id/availability',
    validateToken,
    async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.correlationId;
      const { id }  = req.params;
      const date    = req.query.date as string | undefined;

      if (!date) {
        res.status(400).json({ error: 'Query parameter `date` (YYYY-MM-DD) is required.', code: 'VALIDATION_ERROR' });
        return;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: '`date` must be in YYYY-MM-DD format.', code: 'VALIDATION_ERROR' });
        return;
      }

      try {
        const t0       = Date.now();
        const calendar = await availabilityService.getAvailability(id, date, correlationId);
        const elapsed  = Date.now() - t0;

        // NFR-1: P95 availability-query latency must be <= 500ms
        if (elapsed > 500) {
          logger.warn({
            correlationId,
            component: 'resourceRoutes',
            action:    'AVAILABILITY_LATENCY_BREACH',
            elapsedMs: elapsed,
            threshold: 500,
            fromCache: calendar.fromCache,
          });
        }

        res.json({ ...calendar, _meta: { elapsedMs: elapsed } });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : '';
        logger.error({
          correlationId,
          component: 'resourceRoutes',
          action: 'AVAILABILITY_ERROR',
          error: errorMsg,
          stack: errorStack,
          id,
          date,
        });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR', details: errorMsg });
      }
    },
  );

  // ── POST /resources ────────────────────────────────────────────────────────
  // Create a new resource. ADMIN only.
  router.post(
    '/',
    validateToken,
    enforceRole(['ADMIN']),
    async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.correlationId;

      const { name, typeId, location, capacity, description, amenities } =
        req.body as Partial<CreateResourceRequest>;

      if (!name || !typeId || !location || capacity === undefined) {
        res.status(400).json({
          error: 'Missing required fields: name, typeId, location, capacity',
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      const validTypes = ['SEMINAR_ROOM', 'LAB', 'GPU_CLUSTER', 'EQUIPMENT'];
      if (!validTypes.includes(typeId as string)) {
        res.status(400).json({
          error: `typeId must be one of: ${validTypes.join(', ')}`,
          code:  'VALIDATION_ERROR',
        });
        return;
      }

      if (typeof capacity !== 'number' || capacity < 1) {
        res.status(400).json({ error: 'capacity must be a positive integer', code: 'VALIDATION_ERROR' });
        return;
      }

      try {
        const resource = await resourceRepo.create(
          { name, typeId: typeId as ResourceTypeId, location, capacity, description, amenities },
          req.user!.sub,
          correlationId,
        );

        logger.info({
          correlationId,
          component:  'resourceRoutes',
          action:     'RESOURCE_CREATED',
          resourceId: resource.id,
          createdBy:  req.user!.sub,
        });

        res.status(201).json(resource);
      } catch (err) {
        logger.error({ correlationId, component: 'resourceRoutes', action: 'CREATE_RESOURCE_ERROR', error: (err as Error).message });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  // ── PUT /resources/:id/maintenance ─────────────────────────────────────────
  // Schedule a maintenance window. ADMIN and IT_STAFF only.
  // Immediately invalidates the availability cache for the affected date range.
  router.put(
    '/:id/maintenance',
    validateToken,
    enforceRole(['ADMIN', 'IT_STAFF']),
    async (req: Request, res: Response): Promise<void> => {
      const correlationId = req.correlationId;
      const { id } = req.params;

      const { startTime, endTime, reason } = req.body as Partial<UpdateMaintenanceRequest>;

      if (!startTime || !endTime) {
        res.status(400).json({ error: 'startTime and endTime are required (ISO 8601)', code: 'VALIDATION_ERROR' });
        return;
      }

      const start = new Date(startTime);
      const end   = new Date(endTime);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        res.status(400).json({ error: 'startTime and endTime must be valid ISO 8601 dates', code: 'VALIDATION_ERROR' });
        return;
      }

      if (end <= start) {
        res.status(400).json({ error: 'endTime must be after startTime', code: 'VALIDATION_ERROR' });
        return;
      }

      // Verify resource exists
      const resource = await resourceRepo.findById(id, correlationId);
      if (!resource) {
        res.status(404).json({ error: 'Resource not found', code: 'NOT_FOUND' });
        return;
      }

      try {
        const window = await resourceRepo.upsertMaintenanceWindow(
          id,
          start,
          end,
          reason ?? '',
          req.user!.sub,
          correlationId,
        );

        // Invalidate cache for the date range covered by this maintenance window
        await cacheManager.invalidateDateRange(
          id,
          start.toISOString().slice(0, 10),
          end.toISOString().slice(0, 10),
          correlationId,
        );

        logger.info({
          correlationId,
          component:  'resourceRoutes',
          action:     'MAINTENANCE_SCHEDULED',
          resourceId: id,
          startTime:  start.toISOString(),
          endTime:    end.toISOString(),
          scheduledBy: req.user!.sub,
        });

        res.status(201).json(window);
      } catch (err) {
        logger.error({ correlationId, component: 'resourceRoutes', action: 'MAINTENANCE_ERROR', error: (err as Error).message });
        res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    },
  );

  return router;
}
