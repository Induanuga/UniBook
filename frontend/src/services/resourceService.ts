// src/services/resourceService.ts
// Subsystem 2 — Resource Catalogue API client.
// Calls the unibook-resource-catalogue backend on port 3003.
// All methods require a JWT access token from IAM (Subsystem 1).

import type {
  Resource,
  AvailabilityCalendar,
  ResourceType,
  MaintenanceWindow,
  ResourceSearchFilters,
} from '../types/resource';

const RESOURCE_API =
  import.meta.env.VITE_RESOURCE_API_URL || 'http://localhost:3003';

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function resourceFetch<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res  = await fetch(`${RESOURCE_API}${path}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    const err: { status?: number; body?: unknown; message?: string } & Error =
      new Error(
        (data as { error?: string }).error ||
        (data as { message?: string }).message ||
        `Request failed: ${res.status}`,
      ) as typeof err;
    err.status = res.status;
    err.body   = data;
    throw err;
  }
  return data as T;
}

// ── Build query string from filters ─────────────────────────────────────────

function buildQuery(filters: ResourceSearchFilters): string {
  const params = new URLSearchParams();
  if (filters.type)        params.set('type',        filters.type);
  if (filters.location)    params.set('location',    filters.location);
  if (filters.minCapacity) params.set('minCapacity', String(filters.minCapacity));
  if (filters.date)        params.set('date',        filters.date);
  if (filters.amenities?.length) params.set('amenities', filters.amenities.join(','));
  const q = params.toString();
  return q ? `?${q}` : '';
}

// ── Service exports ──────────────────────────────────────────────────────────

export const resourceService = {
  /**
   * Search / list resources.
   * If filters.date is provided, each resource comes back with an availabilitySummary.
   */
  searchResources: (
    filters: ResourceSearchFilters,
    token: string,
  ): Promise<{ resources: Resource[]; total: number; filters: ResourceSearchFilters }> =>
    resourceFetch(`/resources${buildQuery(filters)}`, {}, token),

  /**
   * Fetch a single resource by ID.
   * Called by the Resource Detail page.
   */
  getResource: (id: string, token: string): Promise<Resource> =>
    resourceFetch(`/resources/${id}`, {}, token),

  /**
   * Fetch the live 15-minute availability calendar for a resource on a date.
   * Backed by Redis cache (30s TTL) — usually returns in ~20ms.
   */
  getAvailability: (
    resourceId: string,
    date: string,
    token: string,
  ): Promise<AvailabilityCalendar> =>
    resourceFetch(`/resources/${resourceId}/availability?date=${date}`, {}, token),

  /**
   * List all resource types (SEMINAR_ROOM, LAB, GPU_CLUSTER, EQUIPMENT).
   */
  getResourceTypes: (token: string): Promise<{ types: ResourceType[] }> =>
    resourceFetch('/resources/types', {}, token),

  /**
   * Create a new resource. ADMIN only.
   */
  createResource: (
    payload: {
      name:        string;
      typeId:      string;
      location:    string;
      capacity:    number;
      description?: string;
      amenities?:  string[];
    },
    token: string,
  ): Promise<Resource> =>
    resourceFetch('/resources', { method: 'POST', body: JSON.stringify(payload) }, token),

  /**
   * Schedule a maintenance window on a resource. ADMIN or IT_STAFF.
   */
  scheduleMaintenance: (
    resourceId: string,
    payload: { startTime: string; endTime: string; reason?: string },
    token: string,
  ): Promise<MaintenanceWindow> =>
    resourceFetch(
      `/resources/${resourceId}/maintenance`,
      { method: 'PUT', body: JSON.stringify(payload) },
      token,
    ),

  /**
   * Health check for the Resource Catalogue backend.
   */
  health: (): Promise<{ status: string; redis: string; cache: { availabilityKeys: number } }> =>
    resourceFetch('/health'),
};