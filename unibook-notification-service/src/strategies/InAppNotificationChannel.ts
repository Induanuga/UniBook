// src/strategies/InAppNotificationChannel.ts
// Strategy — Concrete implementation: stores notification in Postgres.
// The frontend polls GET /notifications/my to retrieve these.

import type { Pool } from 'pg';
import type { INotificationChannel } from './INotificationChannel';
import type { NotificationEvent } from '../types';
import { logger } from '../utils/logger';

export class InAppNotificationChannel implements INotificationChannel {
    readonly channelName = 'IN_APP';

    constructor(private readonly db: Pool) { }

    async deliver(event: NotificationEvent, title: string, message: string): Promise<boolean> {
        try {
            await this.db.query(
                `INSERT INTO notifications
           (recipient_id, recipient_email, event_type, title, message,
            booking_id, approval_id, channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'IN_APP')`,
                [
                    event.recipientId,
                    event.recipientEmail,
                    event.eventType,
                    title,
                    message,
                    event.bookingId ?? null,
                    event.approvalId ?? null,
                ],
            );

            logger.info({
                correlationId: event.correlationId,
                component: 'InAppNotificationChannel',
                action: 'NOTIFICATION_STORED',
                eventType: event.eventType,
                recipientId: event.recipientId,
            });

            return true;
        } catch (err) {
            logger.error({
                correlationId: event.correlationId,
                component: 'InAppNotificationChannel',
                action: 'STORE_FAILED',
                error: (err as Error).message,
            });
            return false;
        }
    }
}
