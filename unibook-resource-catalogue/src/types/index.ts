// src/types/index.ts
// Shared types for the Resource Catalogue subsystem (Subsystem 2).
// JWTPayload mirrors IAM subsystem exactly — same JWT_SECRET, same claims.

export type UserRole = 'STUDENT' | 'FACULTY' | 'ADMIN' | 'IT_STAFF';

// ── JWT (mirrors IAM subsystem) ──────────────────────────────────────────────
export interface JWTPayload {
  jti:        string;
  sub:        string;   // userId
  email:      string;
  name:       string;
  role:       UserRole;
  department: string;
  iat?:       number;
  exp?:       number;
}

// ── Resource domain types ────────────────────────────────────────────────────

export type ResourceTypeId =
  | 'SEMINAR_ROOM'
  | 'LAB'
  | 'GPU_CLUSTER'
  | 'EQUIPMENT';

export interface ResourceType {
  id:          ResourceTypeId;
  name:        string;
  description: string;
  createdAt:   Date;
}

export interface Resource {
  id:          string;
  name:        string;
  typeId:      ResourceTypeId;
  resourceType: string;   // alias exposed to Booking Engine (BookingFacade reads this field)
  location:    string;
  capacity:    number;
  description: string;
  isActive:    boolean;
  amenities:   string[];
  version:     number;
  createdAt:   Date;
  updatedAt:   Date;
}

export interface MaintenanceWindow {
  id:         string;
  resourceId: string;
  startTime:  Date;
  endTime:    Date;
  reason:     string;
  createdBy:  string;
  createdAt:  Date;
}

// ── Availability types ───────────────────────────────────────────────────────

/**
 * A single 15-minute slot in the availability calendar (FR-1).
 */
export interface TimeSlot {
  startTime: string;   // ISO 8601
  endTime:   string;
  status:    'FREE' | 'BOOKED' | 'PENDING' | 'MAINTENANCE';
}

/**
 * Full availability calendar for a resource on a given date range.
 */
export interface AvailabilityCalendar {
  resourceId:   string;
  resourceName: string;
  date:         string;   // YYYY-MM-DD
  slots:        TimeSlot[];
  cachedAt:     string;   // ISO 8601 — when this was computed
  fromCache:    boolean;
}

// ── Booking record (read-only cross-subsystem) ───────────────────────────────
// Resource Catalogue reads bookings table READ-ONLY for availability computation.
export interface BookingRecord {
  id:         string;
  resourceId: string;
  startTime:  Date;
  endTime:    Date;
  status:     'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
}

// ── Search / filter types ────────────────────────────────────────────────────

export interface ResourceSearchFilters {
  type?:         ResourceTypeId;
  location?:     string;
  minCapacity?:  number;
  maxCapacity?:  number;
  amenities?:    string[];
  date?:         string;    // YYYY-MM-DD — if provided, filter by availability
  isActive?:     boolean;
}

export interface ResourceSearchResult {
  resources:  ResourceWithAvailability[];
  total:      number;
  filters:    ResourceSearchFilters;
}

export interface ResourceWithAvailability extends Resource {
  availabilitySummary?: AvailabilitySummary;
}

export interface AvailabilitySummary {
  date:         string;
  totalSlots:   number;
  freeSlots:    number;
  hasAvailability: boolean;
}

// ── Request/Response types ───────────────────────────────────────────────────

export interface CreateResourceRequest {
  name:        string;
  typeId:      ResourceTypeId;
  location:    string;
  capacity:    number;
  description?: string;
  amenities?:  string[];
}

export interface UpdateMaintenanceRequest {
  startTime: string;  // ISO 8601
  endTime:   string;
  reason?:   string;
}

// ── Event types (Observer pattern — cache invalidation from Booking Engine) ──

export type BookingEventType =
  | 'BookingSubmitted'
  | 'BookingApproved'
  | 'BookingRejected'
  | 'BookingCancelled';

export interface BookingEventPayload {
  eventType:     BookingEventType;
  correlationId: string;
  bookingId:     string;
  resourceId:    string;
  userId:        string;
  startTime:     string;
  endTime:       string;
  timestamp:     string;
}

// ── Express augmentation ─────────────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      user?:          JWTPayload;
      correlationId?: string;
    }
  }
}
