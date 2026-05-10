// src/repositories/RetryQueueRepository.ts
// Repository pattern — owns all SQL for notification_retry_queue.
// Implements IRetryQueueRepository so RetryQueue can be tested without a real DB.

import type { Pool } from 'pg';
import type { IRetryQueueRepository, RetryJob } from '../services/RetryQueue';
import type { NotificationEvent } from '../types';
import { logger } from '../utils/logger';

interface RetryRow {
  id: string;
  event_payload: NotificationEvent;
  channel_name: string;
  title: string;
  message: string;
  attempts: number;
  next_retry_at: Date;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  created_at: Date;
}

function mapRow(row: RetryRow): RetryJob {
  return {
    id: row.id,
    event: row.event_payload,
    channelName: row.channel_name,
    title: row.title,
    message: row.message,
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class RetryQueueRepository implements IRetryQueueRepository {
  constructor(private readonly db: Pool) {}

  async enqueue(job: Omit<RetryJob, 'id' | 'createdAt'>): Promise<RetryJob> {
    const result = await this.db.query<RetryRow>(
      `INSERT INTO notification_retry_queue
         (event_payload, channel_name, title, message, attempts, next_retry_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
       RETURNING *`,
      [
        JSON.stringify(job.event),
        job.channelName,
        job.title,
        job.message,
        job.attempts,
        job.nextRetryAt,
      ],
    );
    logger.info({ component: 'RetryQueueRepository', action: 'ENQUEUED', id: result.rows[0].id });
    return mapRow(result.rows[0]);
  }

  /** Fetch all PENDING jobs whose next_retry_at is now due. */
  async getDueJobs(): Promise<RetryJob[]> {
    const result = await this.db.query<RetryRow>(
      `SELECT * FROM notification_retry_queue
       WHERE status = 'PENDING' AND next_retry_at <= NOW()
       ORDER BY next_retry_at ASC
       LIMIT 50`,
    );
    return result.rows.map(mapRow);
  }

  async markSucceeded(id: string): Promise<void> {
    await this.db.query(
      `UPDATE notification_retry_queue SET status = 'SUCCEEDED' WHERE id = $1`,
      [id],
    );
  }

  async markFailed(id: string): Promise<void> {
    await this.db.query(
      `UPDATE notification_retry_queue SET status = 'FAILED' WHERE id = $1`,
      [id],
    );
  }

  async incrementAttempt(id: string, nextRetryAt: Date): Promise<void> {
    await this.db.query(
      `UPDATE notification_retry_queue
       SET attempts = attempts + 1, next_retry_at = $2
       WHERE id = $1`,
      [id, nextRetryAt],
    );
  }
}
