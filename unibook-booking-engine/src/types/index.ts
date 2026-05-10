// src/types/index.ts
// Shared types for the Booking Engine subsystem.
// JWTPayload mirrors the IAM subsystem exactly — used by validateToken middleware.

export type UserRole = 'STUDENT' | 'FACULTY' | 'ADMIN' | 'IT_STAFF';

export type BookingStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'CONFLICT';

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

// ── Core domain types ────────────────────────────────────────────────────────
export interface Booking {
  id:             string;
  resourceId:     string;
  userId:         string;
  userEmail:      string;
  userRole:       UserRole;
  department:     string;
  startTime:      Date;
  endTime:        Date;
  purpose:        string;
  attendeeCount:  number;
  status:         BookingStatus;
  idempotencyKey: string;
  version:        number;
  createdAt:      Date;
  updatedAt:      Date;
}

export interface BookingRequest {
  resourceId:     string;
  startTime:      string;  // ISO 8601
  endTime:        string;  // ISO 8601
  purpose:        string;
  attendeeCount:  number;
  idempotencyKey: string;  // client-generated UUID (required, FR-3)
}

export interface SlotSuggestion {
  startTime: string;
  endTime:   string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

export interface BookingResult {
  success:    boolean;
  booking?:   Booking;
  error?:     string;
  code?:      string;
  suggestions?: SlotSuggestion[];
}

// ── Event types (Observer pattern — ADR-004) ─────────────────────────────────
export type BookingEventType =
  | 'BookingSubmitted'
  | 'BookingApproved'
  | 'BookingRejected'
  | 'BookingCancelled'
  | 'BookingAlternativeSuggested';

export interface BookingEvent {
  eventType:     BookingEventType;
  correlationId: string;
  bookingId:     string;
  resourceId:    string;
  userId:        string;
  userEmail:     string;
  userName?:     string;
  userRole?:     string;
  startTime:     string;
  endTime:       string;
  department:    string;
  purpose?:      string;
  resourceName?: string;
  reason?:       string;
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
