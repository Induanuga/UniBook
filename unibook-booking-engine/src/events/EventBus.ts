// src/events/EventBus.ts
// In-process asynchronous EventBus — Observer pattern (ADR-004).
//
// BookingService publishes typed events AFTER the DB transaction commits.
// Notification and Analytics subsystems subscribe independently.
// The typed envelope carries correlationId for cross-subsystem log tracing (Tactic 5).
//
// Abstraction: the EventBus interface is stable. Swapping to RabbitMQ or Kafka
// in production requires only a new implementation of this interface — zero
// changes to publishers (BookingFacade) or subscribers.

import { EventEmitter } from 'events';
import type { BookingEvent, BookingEventType } from '../types';
import { logger } from '../utils/logger';

type EventHandler = (event: BookingEvent) => void | Promise<void>;

class TypedEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow many subscribers across subsystems without Node.js warning
    this.emitter.setMaxListeners(50);
  }

  /** Publish a booking lifecycle event. Called by BookingFacade after DB commit. */
  publish(event: BookingEvent): void {
    logger.info({
      correlationId: event.correlationId,
      component:     'EventBus',
      action:        'PUBLISH',
      eventType:     event.eventType,
      bookingId:     event.bookingId,
    });
    // setImmediate ensures publish never blocks the booking response
    setImmediate(() => {
      this.emitter.emit(event.eventType, event);
    });
  }

  /** Subscribe to a specific booking event type. */
  subscribe(eventType: BookingEventType, handler: EventHandler): void {
    this.emitter.on(eventType, (event: BookingEvent) => {
      Promise.resolve(handler(event)).catch((err) => {
        logger.error({
          component: 'EventBus',
          action:    'HANDLER_ERROR',
          eventType,
          error:     (err as Error).message,
        });
      });
    });
    logger.info({
      component: 'EventBus',
      action:    'SUBSCRIBED',
      eventType,
    });
  }

  /** Remove all subscribers — used in tests. */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

// Singleton — shared across the entire process
export const eventBus = new TypedEventBus();
