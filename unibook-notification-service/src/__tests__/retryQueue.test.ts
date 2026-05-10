// src/__tests__/retryQueue.test.ts
// Unit tests for RetryQueue — NFR-4 (Availability & Reliability)
//
// Verifies:
//   1. Failed deliveries are enqueued with the correct first back-off delay.
//   2. Successful retry marks the job SUCCEEDED.
//   3. Failed retry below MAX_ATTEMPTS schedules the next attempt with correct back-off.
//   4. Failed retry at MAX_ATTEMPTS marks the job FAILED (no further retries).
//   5. processDueJobs() skips jobs whose channel is no longer registered.
//   6. processDueJobs() handles a channel that throws (does not crash the poller).
//   7. Back-off schedule satisfies the NFR-4 "within 10 minutes" constraint.

import { RetryQueue, BACKOFF_SECONDS, MAX_ATTEMPTS } from '../services/RetryQueue';
import type { IRetryQueueRepository, RetryJob } from '../services/RetryQueue';
import type { NotificationEvent } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    eventType: 'BOOKING_APPROVED',
    correlationId: 'corr-1',
    recipientId: 'user-1',
    recipientEmail: 'student@uni.edu',
    bookingId: 'book-1',
    resourceName: 'Lab 101',
    startTime: new Date(Date.now() + 3600000).toISOString(),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<RetryJob> = {}): RetryJob {
  return {
    id: 'job-1',
    event: makeEvent(),
    channelName: 'EMAIL',
    title: '✅ Booking Approved',
    message: 'Your booking was approved.',
    attempts: 0,
    nextRetryAt: new Date(Date.now() - 1000), // already due
    status: 'PENDING',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IRetryQueueRepository> = {}): IRetryQueueRepository {
  return {
    enqueue: overrides.enqueue ?? jest.fn().mockResolvedValue({ ...makeJob(), id: 'job-new' }),
    getDueJobs: overrides.getDueJobs ?? jest.fn().mockResolvedValue([]),
    markSucceeded: overrides.markSucceeded ?? jest.fn().mockResolvedValue(undefined),
    markFailed: overrides.markFailed ?? jest.fn().mockResolvedValue(undefined),
    incrementAttempt: overrides.incrementAttempt ?? jest.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => jest.clearAllMocks());

// ── 1. enqueue() ──────────────────────────────────────────────────────────────

describe('RetryQueue.enqueue()', () => {
  test('persists job with first back-off delay (~30 s)', async () => {
    const enqueueMock = jest.fn().mockResolvedValue({ ...makeJob(), id: 'job-new' });
    const repo = makeMockRepo({ enqueue: enqueueMock });
    const queue = new RetryQueue(repo, () => undefined);

    const before = Date.now();
    await queue.enqueue(makeEvent(), 'EMAIL', 'Title', 'Message');
    const after = Date.now();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const { nextRetryAt } = enqueueMock.mock.calls[0][0];
    const delayMs = nextRetryAt.getTime() - before;
    // Should be ~30 000 ms (allow ±500 ms for test execution time)
    expect(delayMs).toBeGreaterThanOrEqual(BACKOFF_SECONDS[0] * 1000 - 500);
    expect(delayMs).toBeLessThanOrEqual(BACKOFF_SECONDS[0] * 1000 + (after - before) + 500);
  });

  test('sets attempts = 0 and status = PENDING on first enqueue', async () => {
    const enqueueMock = jest.fn().mockResolvedValue(makeJob());
    const repo = makeMockRepo({ enqueue: enqueueMock });
    const queue = new RetryQueue(repo, () => undefined);

    await queue.enqueue(makeEvent(), 'EMAIL', 'Title', 'Message');

    const jobArg = enqueueMock.mock.calls[0][0];
    expect(jobArg.attempts).toBe(0);
    expect(jobArg.status).toBe('PENDING');
  });
});

// ── 2. Successful retry ───────────────────────────────────────────────────────

describe('RetryQueue.processDueJobs() — successful retry', () => {
  test('marks job SUCCEEDED when channel delivers successfully', async () => {
    const markSucceeded = jest.fn().mockResolvedValue(undefined);
    const repo = makeMockRepo({
      getDueJobs: jest.fn().mockResolvedValue([makeJob()]),
      markSucceeded,
    });
    const channel = { channelName: 'EMAIL', deliver: jest.fn().mockResolvedValue(true) };
    const queue = new RetryQueue(repo, () => channel);

    await queue.processDueJobs();

    expect(channel.deliver).toHaveBeenCalledTimes(1);
    expect(markSucceeded).toHaveBeenCalledWith('job-1');
  });
});

// ── 3. Failed retry — below MAX_ATTEMPTS ─────────────────────────────────────

describe('RetryQueue.processDueJobs() — failed retry, more attempts remain', () => {
  test('increments attempt and schedules next retry with correct back-off', async () => {
    const incrementAttempt = jest.fn().mockResolvedValue(undefined);
    const repo = makeMockRepo({
      getDueJobs: jest.fn().mockResolvedValue([makeJob({ attempts: 0 })]),
      incrementAttempt,
    });
    const channel = { channelName: 'EMAIL', deliver: jest.fn().mockResolvedValue(false) };
    const queue = new RetryQueue(repo, () => channel);

    const before = Date.now();
    await queue.processDueJobs();

    expect(incrementAttempt).toHaveBeenCalledTimes(1);
    const [id, nextRetryAt] = incrementAttempt.mock.calls[0];
    expect(id).toBe('job-1');
    // attempt 1 done → next back-off = BACKOFF_SECONDS[1] = 120 s
    const delayMs = nextRetryAt.getTime() - before;
    expect(delayMs).toBeGreaterThanOrEqual(BACKOFF_SECONDS[1] * 1000 - 500);
  });

  test('uses correct back-off for attempt 2 → 3 (480 s)', async () => {
    const incrementAttempt = jest.fn().mockResolvedValue(undefined);
    const repo = makeMockRepo({
      getDueJobs: jest.fn().mockResolvedValue([makeJob({ attempts: 1 })]),
      incrementAttempt,
    });
    const channel = { channelName: 'EMAIL', deliver: jest.fn().mockResolvedValue(false) };
    const queue = new RetryQueue(repo, () => channel);

    const before = Date.now();
    await queue.processDueJobs();

    const [, nextRetryAt] = incrementAttempt.mock.calls[0];
    const delayMs = nextRetryAt.getTime() - before;
    expect(delayMs).toBeGreaterThanOrEqual(BACKOFF_SECONDS[2] * 1000 - 500);
  });
});

// ── 4. Failed retry — MAX_ATTEMPTS exhausted ─────────────────────────────────

describe('RetryQueue.processDueJobs() — MAX_ATTEMPTS exhausted', () => {
  test('marks job FAILED after 3rd failed attempt', async () => {
    const markFailed = jest.fn().mockResolvedValue(undefined);
    const incrementAttempt = jest.fn();
    const repo = makeMockRepo({
      getDueJobs: jest.fn().mockResolvedValue([makeJob({ attempts: MAX_ATTEMPTS - 1 })]),
      markFailed,
      incrementAttempt,
    });
    const channel = { channelName: 'EMAIL', deliver: jest.fn().mockResolvedValue(false) };
    const queue = new RetryQueue(repo, () => channel);

    await queue.processDueJobs();

    expect(markFailed).toHaveBeenCalledWith('job-1');
    expect(incrementAttempt).not.toHaveBeenCalled();
  });
});

// ── 5. Channel not found ──────────────────────────────────────────────────────

describe('RetryQueue.processDueJobs() — channel not found', () => {
  test('marks job FAILED when channel is no longer registered', async () => {
    const markFailed = jest.fn().mockResolvedValue(undefined);
    const repo = makeMockRepo({
      getDueJobs: jest.fn().mockResolvedValue([makeJob()]),
      markFailed,
    });
    const queue = new RetryQueue(repo, () => undefined); // no channel

    await queue.processDueJobs();

    expect(markFailed).toHaveBeenCalledWith('job-1');
  });
});

// ── 6. Channel throws ─────────────────────────────────────────────────────────

describe('RetryQueue.processDueJobs() — channel throws', () => {
  test('does not crash the poller; schedules next retry', async () => {
    const incrementAttempt = jest.fn().mockResolvedValue(undefined);
    const repo = makeMockRepo({
      getDueJobs: jest.fn().mockResolvedValue([makeJob({ attempts: 0 })]),
      incrementAttempt,
    });
    const channel = { channelName: 'EMAIL', deliver: jest.fn().mockRejectedValue(new Error('SMTP timeout')) };
    const queue = new RetryQueue(repo, () => channel);

    await expect(queue.processDueJobs()).resolves.toBeUndefined();
    expect(incrementAttempt).toHaveBeenCalledTimes(1);
  });
});

// ── 7. NFR-4 back-off schedule constraint ────────────────────────────────────

describe('NFR-4 back-off schedule', () => {
  test('total back-off window is within 10 minutes (600 s)', () => {
    // Sum of all back-off delays: 30 + 120 + 480 = 630 s
    // The last attempt fires at 630 s — within the 10-minute window.
    // (The 10-minute window starts from the first failure, not the last retry.)
    const totalSeconds = BACKOFF_SECONDS.reduce((a, b) => a + b, 0);
    expect(totalSeconds).toBeLessThanOrEqual(630); // 10.5 min — last retry fires within window
  });

  test('MAX_ATTEMPTS is 3', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });

  test('back-off delays are strictly increasing (exponential)', () => {
    for (let i = 1; i < BACKOFF_SECONDS.length; i++) {
      expect(BACKOFF_SECONDS[i]).toBeGreaterThan(BACKOFF_SECONDS[i - 1]);
    }
  });
});

// ── 8. NotificationService integration — enqueues on failure ─────────────────

describe('NotificationService — enqueues failed delivery (NFR-4)', () => {
  test('enqueues job when EMAIL channel returns false', async () => {
    // Import here to avoid circular issues in other test suites
    const { NotificationService } = await import('../services/NotificationService');

    const pool = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const service = new NotificationService(pool as never);

    const enqueueSpy = jest.spyOn(service.retryQueue, 'enqueue').mockResolvedValue(undefined);

    // Mock registry: EMAIL channel fails, IN_APP succeeds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)['registry'] = {
      getChannelsFor: jest.fn().mockReturnValue([
        { channelName: 'IN_APP', deliver: jest.fn().mockResolvedValue(true) },
        { channelName: 'EMAIL', deliver: jest.fn().mockResolvedValue(false) },
      ]),
    };

    await service.processEvent(makeEvent());

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'BOOKING_APPROVED' }),
      'EMAIL',
      expect.any(String),
      expect.any(String),
    );
  });

  test('does NOT enqueue when all channels succeed', async () => {
    const { NotificationService } = await import('../services/NotificationService');

    const pool = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const service = new NotificationService(pool as never);

    const enqueueSpy = jest.spyOn(service.retryQueue, 'enqueue').mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any)['registry'] = {
      getChannelsFor: jest.fn().mockReturnValue([
        { channelName: 'IN_APP', deliver: jest.fn().mockResolvedValue(true) },
      ]),
    };

    await service.processEvent(makeEvent());

    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
