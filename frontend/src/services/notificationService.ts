// src/services/notificationService.ts
// API client for Subsystem 5 — Notification Service (port 3005)

const NOTIFICATION_API = import.meta.env.VITE_NOTIFICATION_API_URL || 'http://localhost:3005';

async function notifFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string>),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${NOTIFICATION_API}${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error(data.error || `Request failed: ${res.status}`);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data as T;
}

export type NotificationEventType =
    | 'BOOKING_APPROVED'
    | 'BOOKING_REJECTED'
    | 'ALTERNATIVE_SUGGESTED'
    | 'ASSIGNMENT_PENDING'
    | 'ESCALATION_ASSIGNED'
    | 'BOOKING_SUBMITTED';

export interface AppNotification {
    id: string;
    recipientId: string;
    recipientEmail: string;
    eventType: NotificationEventType;
    title: string;
    message: string;
    bookingId?: string;
    approvalId?: string;
    channel: 'IN_APP' | 'EMAIL' | 'BOTH';
    isRead: boolean;
    readAt?: string;
    createdAt: string;
}

export const notificationService = {
    getMyNotifications: (token: string): Promise<{ notifications: AppNotification[] }> =>
        notifFetch('/notifications/my', {}, token),

    getUnreadCount: (token: string): Promise<{ count: number }> =>
        notifFetch('/notifications/unread-count', {}, token),

    markRead: (id: string, token: string): Promise<{ notification: AppNotification }> =>
        notifFetch(`/notifications/${id}/read`, { method: 'PATCH' }, token),

    markAllRead: (token: string): Promise<{ count: number; message: string }> =>
        notifFetch('/notifications/read-all', { method: 'PATCH' }, token),

    health: (): Promise<{ status: string }> =>
        notifFetch('/health'),
};
