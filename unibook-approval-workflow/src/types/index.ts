// src/types/index.ts
// Shared types for the Approval Workflow subsystem.
// JWTPayload mirrors the IAM subsystem — used by validateToken middleware.

export type UserRole = 'STUDENT' | 'FACULTY' | 'ADMIN' | 'IT_STAFF';

export type ApprovalStatus =
  | 'AWAITING_FACULTY'   // Student booking — sent to all faculty for review
  | 'AWAITING_ADMIN'     // Faculty booking OR escalated student booking → all admins
  | 'APPROVED'
  | 'REJECTED'
  | 'ALTERNATIVE_SUGGESTED';

export type DecisionType = 'APPROVE' | 'REJECT' | 'SUGGEST_ALTERNATIVE';

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

/**
 * ApprovalRequest — one approval lifecycle started per booking.
 * Multiple approvers may exist (all faculty, or all admins).
 */
export interface ApprovalRequest {
  id:                string;
  bookingId:         string;
  resourceId:        string;
  requesterId:       string;
  requesterEmail:    string;
  requesterRole:     UserRole;
  requesterName:     string;
  department:        string;
  startTime:         Date;
  endTime:           Date;
  purpose:           string;
  resourceName?:     string;
  status:            ApprovalStatus;
  currentLevel:      'FACULTY' | 'ADMIN';  // Which pool of approvers is active
  decidedById?:      string;               // Who made the decision
  decidedByEmail?:   string;
  decisionReason?:   string;
  alternativeSlot?:  { startTime: string; endTime: string };  // If SUGGEST_ALTERNATIVE
  escalatedAt?:      Date;                 // When escalated from faculty → admin
  decidedAt?:        Date;
  createdAt:         Date;
  updatedAt:         Date;
}

/**
 * ApproverAssignment — tracks which approvers have been notified
 * and whether they have decided.
 * Implements the "broadcast to all, first-one-wins" model:
 *   - Student books → all FACULTY assigned
 *   - First faculty to decide closes the request (removes others)
 *   - If no faculty responds in escalationHours → all ADMIN assigned
 *   - First admin to decide closes the request
 */
export interface ApproverAssignment {
  id:              string;
  approvalId:      string;
  approverId:      string;
  approverEmail:   string;
  approverRole:    'FACULTY' | 'ADMIN';
  assignedAt:      Date;
  isActive:        boolean;   // false once someone else decides (or this user decides)
  decidedAt?:      Date;
  decision?:       DecisionType;
}

// ── Request/Response DTOs ────────────────────────────────────────────────────

export interface DecisionRequest {
  decision:          DecisionType;
  reason?:           string;
  alternativeStart?: string;  // ISO 8601 — required if SUGGEST_ALTERNATIVE
  alternativeEnd?:   string;  // ISO 8601 — required if SUGGEST_ALTERNATIVE
}

export interface ApprovalSummary {
  id:               string;
  bookingId:        string;
  resourceName?:    string;
  requesterEmail:   string;
  requesterRole:    UserRole;
  startTime:        string;
  endTime:          string;
  purpose:          string;
  status:           ApprovalStatus;
  currentLevel:     'FACULTY' | 'ADMIN';
  createdAt:        string;
}

// ── Event types (Observer pattern — ADR-004) ─────────────────────────────────
export type ApprovalEventType =
  | 'BookingSubmitted'
  | 'ApprovalDecided';

export interface BookingSubmittedEvent {
  eventType:      'BookingSubmitted';
  correlationId:  string;
  bookingId:      string;
  resourceId:     string;
  userId:         string;
  userEmail:      string;
  userName?:      string;
  userRole:       string;
  department:     string;
  startTime:      string;
  endTime:        string;
  purpose:        string;
  resourceName?:  string;
  timestamp:      string;
}

export interface BookingCancelledEvent {
  eventType:      'BookingCancelled';
  correlationId:  string;
  bookingId:      string;
  resourceId:     string;
  userId:         string;
  userEmail:      string;
  startTime:      string;
  endTime:        string;
  department:     string;
  timestamp:      string;
}

export type BookingEvent = BookingSubmittedEvent | BookingCancelledEvent;

export interface ApprovalDecidedEvent {
  eventType:      'ApprovalDecided';
  correlationId:  string;
  approvalId:     string;
  bookingId:      string;
  decision:       DecisionType;
  decidedById:    string;
  decidedByEmail: string;
  reason?:        string;
  alternativeSlot?: string;
  timestamp:      string;
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
