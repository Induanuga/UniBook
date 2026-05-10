// src/types/index.ts
// Shared types for the Analytics & Reporting Service (Subsystem 6).

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

// ── Analytics event (consumed from Booking Engine / Approval Workflow) ────────
export type AnalyticsEventType =
  | 'BookingApproved'
  | 'BookingCancelled'
  | 'BookingSubmitted'
  | 'BookingRejected'
  | 'BookingAlternativeSuggested';

export interface AnalyticsEvent {
  eventType:    AnalyticsEventType;
  correlationId: string;
  bookingId:    string;
  resourceId:   string;
  userId:       string;
  department:   string;
  startTime:    string;   // ISO 8601
  endTime:      string;   // ISO 8601
  timestamp:    string;   // ISO 8601 — when the event was emitted
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
// One cell = one (hour, day-of-week) bucket with a booking count.
export interface HeatmapCell {
  hour:       number;   // 0–23
  dayOfWeek:  number;   // 0 = Sunday … 6 = Saturday
  count:      number;
}

export interface HeatmapResult {
  resourceId?:  string;
  department?:  string;
  from:         string;
  to:           string;
  cells:        HeatmapCell[];
}

// ── Summary ───────────────────────────────────────────────────────────────────
export interface AnalyticsSummary {
  totalApproved:             number;
  totalCancelled:            number;
  totalSubmitted:            number;
  totalRejected:             number;
  totalAlternativeSuggested: number;
  from:                      string;
  to:                        string;
}

// ── CSV export row ────────────────────────────────────────────────────────────
export interface AnalyticsEventRow {
  id:          string;
  eventType:   string;
  bookingId:   string;
  resourceId:  string;
  userId:      string;
  department:  string;
  startTime:   Date;
  endTime:     Date;
  recordedAt:  Date;
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
