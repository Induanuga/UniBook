// src/repositories/NotificationRepository.ts
// Repository pattern — owns all SQL for the notifications table.

import type { Pool } from 'pg';
import type { Notification } from '../types';
import { logger } from '../utils/logger';

interface NotificationRow {
    id: string;
    recipient_id: string;
    recipient_email: string;
    event_type: string;
    title: string;
    message: string;
    booking_id: string | null;
    approval_id: string | null;
    channel: string;
    is_read: boolean;
    read_at: Date | null;
    created_at: Date;
}

function mapRow(row: NotificationRow): Notification {
    return {
        id: row.id,
        recipientId: row.recipient_id,
        recipientEmail: row.recipient_email,
        eventType: row.event_type as Notification['eventType'],
        title: row.title,
        message: row.message,
        bookingId: row.booking_id ?? undefined,
        approvalId: row.approval_id ?? undefined,
        channel: row.channel as Notification['channel'],
        isRead: row.is_read,
        readAt: row.read_at ?? undefined,
        createdAt: row.created_at,
    };
}

export class NotificationRepository {
    constructor(private readonly db: Pool) { }

    /** Get all notifications for a recipient, newest first. */
    async findByRecipientId(recipientId: string): Promise<Notification[]> {
        const result = await this.db.query<NotificationRow>(
            `SELECT * FROM notifications
       WHERE recipient_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
            [recipientId],
        );
        return result.rows.map(mapRow);
    }

    /** Count unread notifications for a recipient. */
    async countUnread(recipientId: string): Promise<number> {
        const result = await this.db.query<{ count: string }>(
            `SELECT COUNT(*) AS count FROM notifications
       WHERE recipient_id = $1 AND is_read = FALSE`,
            [recipientId],
        );
        return parseInt(result.rows[0]?.count ?? '0', 10);
    }

    /** Mark a single notification as read. Returns the updated row or null. */
    async markRead(notificationId: string, recipientId: string): Promise<Notification | null> {
        const result = await this.db.query<NotificationRow>(
            `UPDATE notifications
       SET is_read = TRUE, read_at = NOW()
       WHERE id = $1 AND recipient_id = $2
       RETURNING *`,
            [notificationId, recipientId],
        );
        return result.rows[0] ? mapRow(result.rows[0]) : null;
    }

    /** Mark all notifications for a recipient as read. Returns count updated. */
    async markAllRead(recipientId: string): Promise<number> {
        const result = await this.db.query(
            `UPDATE notifications
       SET is_read = TRUE, read_at = NOW()
       WHERE recipient_id = $1 AND is_read = FALSE`,
            [recipientId],
        );
        return result.rowCount ?? 0;
    }

    /** Called by InAppNotificationChannel — direct insert (also used in tests). */
    async insert(data: {
        recipientId: string;
        recipientEmail: string;
        eventType: string;
        title: string;
        message: string;
        bookingId?: string;
        approvalId?: string;
        channel?: string;
    }): Promise<Notification> {
        const result = await this.db.query<NotificationRow>(
            `INSERT INTO notifications
         (recipient_id, recipient_email, event_type, title, message,
          booking_id, approval_id, channel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
            [
                data.recipientId,
                data.recipientEmail,
                data.eventType,
                data.title,
                data.message,
                data.bookingId ?? null,
                data.approvalId ?? null,
                data.channel ?? 'IN_APP',
            ],
        );

        logger.info({
            component: 'NotificationRepository',
            action: 'INSERTED',
            eventType: data.eventType,
            recipientId: data.recipientId,
        });

        return mapRow(result.rows[0]);
    }
}
