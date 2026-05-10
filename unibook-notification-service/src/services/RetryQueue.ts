// src/services/RetryQueue.ts
// NFR-4 — Availability & Reliability
//
// "Failed notifications retried up to 3 times within 10 minutes
//  with exponential back-off." (Architecture Report, NFR-4)
//
// Mechanism:
//   - On delivery failure, the failed job is persisted to notification_retry_queue.
//   - A background timer polls the table every POLL_INTERVAL_MS for due jobs.
//   - Back-off schedule: attempt 1 → +30 s, attempt 2 → +120 s, attempt 3 → +480 s
//     (total window ≤ 10 minutes, satisfying NFR-4).
//   - After 3 failed attempts the job is marked FAILED and no further retries occur.
//   - The queue is durable (PostgreSQL) — survives process restarts.
//
// Design patterns:
//   - Repository: all SQL isolated in RetryQueueRepository (injected via constructor).
//   - Strategy: re-uses INotificationChannel.deliver() — no channel-specific logic here.

import type { INotificationChannel } from '../strategies/INotificationChannel';
import type { NotificationEvent } from '../types';
import { logger } from '../utils/logger';

// ── Back-off schedule (seconds) ───────────────────────────────────────────────
// attempt 1 → 30 s, attempt 2 → 120 s, attempt 3 → 480 s  (total ≤ 630 s < 10 min)
export const BACKOFF_SECONDS = [30, 120, 480] as const;
export const MAX_ATTEMPTS = 3;

// ── Retry job shape (mirrors DB row) ─────────────────────────────────────────
export interface RetryJob {
  id: string;
  event: NotificationEvent;
  channelName: string;
  title: string;
  message: string;
  attempts: number;
  nextRetryAt: Date;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  createdAt: Date;
}

// ── Minimal repository interface (injected — testable without real DB) ────────
export interface IRetryQueueRepository {
  enqueue(job: Omit<RetryJob, 'id' | 'createdAt'>): Promise<RetryJob>;
  getDueJobs(): Promise<RetryJob[]>;
  markSucceeded(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
  incrementAttempt(id: string, nextRetryAt: Date): Promise<void>;
}

// ── RetryQueue ────────────────────────────────────────────────────────────────
export class RetryQueue {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repo: IRetryQueueRepository,
    private readonly getChannel: (name: string) => INotificationChannel | undefined,
    private readonly pollIntervalMs: number = 15_000,
  ) {}

  /**
   * Enqueue a failed delivery for retry.
   * Called by NotificationService when a channel returns false or throws.
   */
  async enqueue(
    event: NotificationEvent,
    channelName: string,
    title: string,
    message: string,
  ): Promise<void> {
    const nextRetryAt = new Date(Date.now() + BACKOFF_SECONDS[0] * 1000);
    await this.repo.enqueue({
      event,
      channelName,
      title,
      message,
      attempts: 0,
      nextRetryAt,
      status: 'PENDING',
    });
    logger.info({
      correlationId: event.correlationId,
      component: 'RetryQueue',
      action: 'ENQUEUED',
      channelName,
      nextRetryAt: nextRetryAt.toISOString(),
    });
  }

  /** Start the background polling loop. Call once at server startup. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processDueJobs().catch((err) =>
        logger.error({ component: 'RetryQueue', action: 'POLL_ERROR', error: (err as Error).message }),
      );
    }, this.pollIntervalMs);
    logger.info({ component: 'RetryQueue', action: 'STARTED', pollIntervalMs: this.pollIntervalMs });
  }

  /** Stop the background polling loop. Call on graceful shutdown. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info({ component: 'RetryQueue', action: 'STOPPED' });
    }
  }

  /** Process all jobs whose next_retry_at <= NOW(). */
  async processDueJobs(): Promise<void> {
    const jobs = await this.repo.getDueJobs();
    for (const job of jobs) {
      await this.processJob(job);
    }
  }

  private async processJob(job: RetryJob): Promise<void> {
    const channel = this.getChannel(job.channelName);
    if (!channel) {
      logger.warn({ component: 'RetryQueue', action: 'CHANNEL_NOT_FOUND', channelName: job.channelName, jobId: job.id });
      await this.repo.markFailed(job.id);
      return;
    }

    const attemptNumber = job.attempts + 1;
    let success = false;

    try {
      success = await channel.deliver(job.event, job.title, job.message);
    } catch (err) {
      logger.warn({
        correlationId: job.event.correlationId,
        component: 'RetryQueue',
        action: 'ATTEMPT_THREW',
        jobId: job.id,
        attempt: attemptNumber,
        error: (err as Error).message,
      });
    }

    if (success) {
      await this.repo.markSucceeded(job.id);
      logger.info({
        correlationId: job.event.correlationId,
        component: 'RetryQueue',
        action: 'RETRY_SUCCEEDED',
        jobId: job.id,
        attempt: attemptNumber,
        channelName: job.channelName,
      });
      return;
    }

    // Delivery failed again
    if (attemptNumber >= MAX_ATTEMPTS) {
      await this.repo.markFailed(job.id);
      logger.error({
        correlationId: job.event.correlationId,
        component: 'RetryQueue',
        action: 'RETRY_EXHAUSTED',
        jobId: job.id,
        attempts: attemptNumber,
        channelName: job.channelName,
      });
      return;
    }

    // Schedule next attempt
    const backoffSec = BACKOFF_SECONDS[attemptNumber] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1];
    const nextRetryAt = new Date(Date.now() + backoffSec * 1000);
    await this.repo.incrementAttempt(job.id, nextRetryAt);
    logger.warn({
      correlationId: job.event.correlationId,
      component: 'RetryQueue',
      action: 'RETRY_SCHEDULED',
      jobId: job.id,
      attempt: attemptNumber,
      nextRetryAt: nextRetryAt.toISOString(),
      backoffSec,
    });
  }
}
