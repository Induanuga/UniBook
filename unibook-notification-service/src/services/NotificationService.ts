// src/services/NotificationService.ts
// Core service for the Notification subsystem.
//
// Design Patterns:
//   - Observer (subscribes to events pushed by Approval Workflow via webhooks)
//   - Strategy (delegates delivery to channels via NotificationChannelRegistry)
//   - Repository (all SQL isolated in NotificationRepository)
//   - Facade (single entry point used by routes and webhook handler)
//
// NFR-4 (Availability & Reliability):
//   Failed channel deliveries are enqueued in RetryQueue for exponential back-off
//   retry (up to 3 attempts within 10 minutes). The queue is durable (PostgreSQL).
//
// Event → notification message map lives here so all copy is in one place.

import type { Pool } from 'pg';
import type { NotificationEvent, Notification, NotificationEventType } from '../types';
import { NotificationRepository } from '../repositories/NotificationRepository';
import { NotificationChannelRegistry } from '../strategies/NotificationChannelRegistry';
import { InAppNotificationChannel } from '../strategies/InAppNotificationChannel';
import { EmailNotificationChannel } from '../strategies/EmailNotificationChannel';
import { RetryQueue } from './RetryQueue';
import { RetryQueueRepository } from '../repositories/RetryQueueRepository';
import { logger } from '../utils/logger';

// ── Notification copy ─────────────────────────────────────────────────────────
interface NotificationCopy {
    title: string;
    message: (event: NotificationEvent) => string;
}

const COPY: Record<NotificationEventType, NotificationCopy> = {
    BOOKING_APPROVED: {
        title: '✅ Booking Approved',
        message: (e) =>
            `Your booking for ${e.resourceName ?? 'a resource'} on ` +
            `${e.startTime ? new Date(e.startTime).toLocaleString() : 'the requested date'} ` +
            `has been approved.`,
    },
    BOOKING_REJECTED: {
        title: '❌ Booking Rejected',
        message: (e) =>
            `Your booking for ${e.resourceName ?? 'a resource'} has been rejected.` +
            (e.reason ? ` Reason: ${e.reason}` : ''),
    },
    ALTERNATIVE_SUGGESTED: {
        title: '🔄 Alternative Slot Suggested',
        message: (e) =>
            `Your booking for ${e.resourceName ?? 'a resource'} could not be approved as requested. ` +
            `An alternative time slot has been suggested — please check your approval status.` +
            (e.reason ? ` Note: ${e.reason}` : ''),
    },
    ASSIGNMENT_PENDING: {
        title: '📋 New Booking Request to Review',
        message: (e) =>
            `A new booking request for ${e.resourceName ?? 'a resource'} ` +
            `is pending your review.` +
            (e.startTime
                ? ` Requested for: ${new Date(e.startTime).toLocaleString()}.`
                : ''),
    },
    ESCALATION_ASSIGNED: {
        title: '⚡ Escalated Booking Request',
        message: (e) =>
            `A booking request for ${e.resourceName ?? 'a resource'} has been escalated ` +
            `to admins for review after no faculty response. Please action it promptly.`,
    },
    BOOKING_SUBMITTED: {
        title: '📨 Booking Submitted',
        message: (e) =>
            `A new booking request for ${e.resourceName ?? 'a resource'} has been submitted ` +
            `and is pending approval.` +
            (e.startTime ? ` Requested for: ${new Date(e.startTime).toLocaleString()}.` : ''),
    },
    BOOKING_REMINDER: {
        title: '⏰ Booking Reminder',
        message: (e) =>
            `Reminder: your approved booking for ${e.resourceName ?? 'a resource'} ` +
            `is coming up in 24 hours.` +
            (e.startTime ? ` Scheduled for: ${new Date(e.startTime).toLocaleString()}.` : ''),
    },
};

// ── Service ───────────────────────────────────────────────────────────────────
export class NotificationService {
    private readonly repo: NotificationRepository;
    private readonly registry: NotificationChannelRegistry;
    readonly retryQueue: RetryQueue;

    constructor(private readonly db: Pool) {
        this.repo = new NotificationRepository(db);
        this.registry = new NotificationChannelRegistry();

        // Wire channels (Strategy pattern)
        const inApp = new InAppNotificationChannel(db);
        const email = new EmailNotificationChannel();
        this.registry.register(inApp);
        this.registry.register(email);

        // NFR-4: durable retry queue backed by PostgreSQL
        const retryRepo = new RetryQueueRepository(db);
        this.retryQueue = new RetryQueue(
            retryRepo,
            (name) => this.registry.getChannelByName(name),
        );
    }

    /**
     * Process an incoming notification event (Observer — called by webhook handler).
     * Determines copy, selects channels, delivers via each.
     * NFR-4: failed deliveries are enqueued for exponential back-off retry.
     */
    async processEvent(event: NotificationEvent): Promise<void> {
        const copy = COPY[event.eventType];
        if (!copy) {
            logger.warn({
                correlationId: event.correlationId,
                component: 'NotificationService',
                action: 'UNKNOWN_EVENT_TYPE',
                eventType: event.eventType,
            });
            return;
        }

        const title = copy.title;
        const message = copy.message(event);

        const channels = this.registry.getChannelsFor(event.eventType);

        const results = await Promise.allSettled(
            channels.map((channel) => channel.deliver(event, title, message)),
        );

        // NFR-4: enqueue any failed deliveries for retry
        for (let i = 0; i < channels.length; i++) {
            const result = results[i];
            const channel = channels[i];
            const failed =
                result.status === 'rejected' ||
                (result.status === 'fulfilled' && result.value === false);

            if (failed) {
                await this.retryQueue.enqueue(event, channel.channelName, title, message);
            }
        }

        logger.info({
            correlationId: event.correlationId,
            component: 'NotificationService',
            action: 'EVENT_PROCESSED',
            eventType: event.eventType,
            recipientId: event.recipientId,
            channels: channels.map((c) => c.channelName),
        });
    }

    /** Get all notifications for a user (newest first). */
    async getMyNotifications(userId: string): Promise<Notification[]> {
        return this.repo.findByRecipientId(userId);
    }

    /** Count unread notifications for a user. */
    async getUnreadCount(userId: string): Promise<number> {
        return this.repo.countUnread(userId);
    }

    /** Mark a single notification as read. */
    async markRead(notificationId: string, userId: string): Promise<Notification | null> {
        return this.repo.markRead(notificationId, userId);
    }

    /** Mark all notifications for a user as read. */
    async markAllRead(userId: string): Promise<number> {
        return this.repo.markAllRead(userId);
    }
}
