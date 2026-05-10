// src/types/index.ts
// Shared types for the Notification Service subsystem.

export type UserRole = 'STUDENT' | 'FACULTY' | 'ADMIN' | 'IT_STAFF';

export type NotificationEventType =
    | 'BOOKING_APPROVED'
    | 'BOOKING_REJECTED'
    | 'ALTERNATIVE_SUGGESTED'
    | 'ASSIGNMENT_PENDING'
    | 'ESCALATION_ASSIGNED'
    | 'BOOKING_SUBMITTED';

export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'BOTH';

// ── JWT (mirrors IAM subsystem) ──────────────────────────────────────────────
export interface JWTPayload {
    jti: string;
    sub: string;   // userId
    email: string;
    name: string;
    role: UserRole;
    department: string;
    iat?: number;
    exp?: number;
}

// ── Core domain type ─────────────────────────────────────────────────────────
export interface Notification {
    id: string;
    recipientId: string;
    recipientEmail: string;
    eventType: NotificationEventType;
    title: string;
    message: string;
    bookingId?: string;
    approvalId?: string;
    channel: NotificationChannel;
    isRead: boolean;
    readAt?: Date;
    createdAt: Date;
}

// ── Webhook payload (sent by Approval Workflow) ───────────────────────────────
export interface NotificationEvent {
    eventType: NotificationEventType;
    correlationId: string;
    recipientId: string;
    recipientEmail: string;
    recipientName?: string;
    bookingId?: string;
    approvalId?: string;
    resourceName?: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
    timestamp: string;
}

// ── Express augmentation ─────────────────────────────────────────────────────
declare global {
    namespace Express {
        interface Request {
            user?: JWTPayload;
            correlationId?: string;
        }
    }
}
