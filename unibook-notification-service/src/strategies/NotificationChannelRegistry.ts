// src/strategies/NotificationChannelRegistry.ts
// Strategy Registry — selects which channels to use per event type.
//
// Default behaviour:
//   - All events → IN_APP always
//   - BOOKING_APPROVED, BOOKING_REJECTED → IN_APP + EMAIL (if enabled)
//
// Adding a new channel or routing rule requires only a change here — zero
// changes to NotificationService (Open/Closed Principle, NFR-3).

import type { INotificationChannel } from './INotificationChannel';
import type { NotificationEventType } from '../types';

export class NotificationChannelRegistry {
    private readonly channels: Map<string, INotificationChannel> = new Map();

    /** Register a channel by its name. */
    register(channel: INotificationChannel): void {
        this.channels.set(channel.channelName, channel);
    }

    /**
     * Returns the channels to use for a given event type.
     * Always includes IN_APP. Adds EMAIL for final-decision events and reminders.
     */
    getChannelsFor(eventType: NotificationEventType): INotificationChannel[] {
        const emailEvents: NotificationEventType[] = [
            'BOOKING_APPROVED',
            'BOOKING_REJECTED',
            'ALTERNATIVE_SUGGESTED',
            'BOOKING_REMINDER',
        ];

        const selected: INotificationChannel[] = [];

        const inApp = this.channels.get('IN_APP');
        if (inApp) selected.push(inApp);

        if (emailEvents.includes(eventType)) {
            const email = this.channels.get('EMAIL');
            if (email) selected.push(email);
        }

        return selected;
    }

    /** Look up a channel by name — used by RetryQueue to re-deliver failed jobs. */
    getChannelByName(name: string): INotificationChannel | undefined {
        return this.channels.get(name);
    }
}
