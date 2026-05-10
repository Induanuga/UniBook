// src/strategies/INotificationChannel.ts
// Strategy pattern — GoF Behavioral (Pattern 19)
//
// Each concrete channel implements this interface.
// NotificationService selects channels via NotificationChannelRegistry
// without knowing any channel implementation details.

import type { NotificationEvent } from '../types';

export interface INotificationChannel {
    /** Deliver a notification. Returns true on success. */
    deliver(event: NotificationEvent, title: string, message: string): Promise<boolean>;

    /** Human-readable name of the channel — used in logs. */
    readonly channelName: string;
}
