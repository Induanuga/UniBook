// src/__tests__/eventBus.test.ts
// Unit tests for the EventBus (Observer pattern — ADR-004).

import { eventBus } from '../events/EventBus';
import type { BookingEvent } from '../types';

function makeEvent(overrides: Partial<BookingEvent> = {}): BookingEvent {
  return {
    eventType:     'BookingSubmitted',
    correlationId: 'corr-1',
    bookingId:     'booking-1',
    resourceId:    'res-1',
    userId:        'user-1',
    userEmail:     'test@uni.edu',
    startTime:     new Date().toISOString(),
    endTime:       new Date().toISOString(),
    department:    'CS',
    timestamp:     new Date().toISOString(),
    ...overrides,
  };
}

afterEach(() => {
  eventBus.removeAllListeners();
});

describe('EventBus', () => {
  test('subscriber receives published event', (done) => {
    eventBus.subscribe('BookingSubmitted', (event) => {
      expect(event.bookingId).toBe('booking-1');
      expect(event.correlationId).toBe('corr-1');
      done();
    });
    eventBus.publish(makeEvent());
  });

  test('multiple subscribers independently receive the same event', (done) => {
    let count = 0;
    const check = () => { if (++count === 2) done(); };

    eventBus.subscribe('BookingSubmitted', check);
    eventBus.subscribe('BookingSubmitted', check);
    eventBus.publish(makeEvent());
  });

  test('subscriber for different event type does NOT receive event', (done) => {
    const wrongHandler = jest.fn();
    eventBus.subscribe('BookingCancelled', wrongHandler);

    eventBus.subscribe('BookingSubmitted', () => {
      // Small delay to let wrongHandler fire if it incorrectly does
      setTimeout(() => {
        expect(wrongHandler).not.toHaveBeenCalled();
        done();
      }, 20);
    });

    eventBus.publish(makeEvent({ eventType: 'BookingSubmitted' }));
  });

  test('publish does not throw when no subscribers exist', () => {
    expect(() => eventBus.publish(makeEvent({ eventType: 'BookingApproved' }))).not.toThrow();
  });

  test('async handler error is caught and second subscriber still fires', (done) => {
    // Async throw — EventBus wraps handlers in Promise.resolve().catch()
    eventBus.subscribe('BookingSubmitted', async () => {
      throw new Error('handler error');
    });

    // Second subscriber must still fire despite first one rejecting
    eventBus.subscribe('BookingSubmitted', () => {
      done();
    });

    eventBus.publish(makeEvent());
  });

  test('BookingCancelled event carries correct payload', (done) => {
    eventBus.subscribe('BookingCancelled', (event) => {
      expect(event.eventType).toBe('BookingCancelled');
      expect(event.reason).toBe('User cancelled');
      done();
    });

    eventBus.publish(makeEvent({ eventType: 'BookingCancelled', reason: 'User cancelled' }));
  });
});
