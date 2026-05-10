-- UniBook Notification Service — Database Schema (Subsystem 5)
-- Run via: npm run db:migrate

-- ── Notifications table ─────────────────────────────────────────────────────
-- One row per notification delivered to a user.
-- Strategy pattern: channel column records which channel delivered it.
-- 'IN_APP' notifications are stored here and polled by the frontend.

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID         NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  event_type      VARCHAR(60)  NOT NULL
                    CHECK (event_type IN (
                      'BOOKING_APPROVED',
                      'BOOKING_REJECTED',
                      'ALTERNATIVE_SUGGESTED',
                      'ASSIGNMENT_PENDING',
                      'ESCALATION_ASSIGNED',
                      'BOOKING_SUBMITTED',
                      'BOOKING_REMINDER'
                    )),
  title           VARCHAR(255) NOT NULL,
  message         TEXT         NOT NULL,
  booking_id      UUID,
  approval_id     UUID,
  channel         VARCHAR(20)  NOT NULL DEFAULT 'IN_APP'
                    CHECK (channel IN ('IN_APP', 'EMAIL', 'BOTH')),
  is_read         BOOLEAN      NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id
  ON notifications(recipient_id);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications(recipient_id, is_read)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications(created_at DESC);

-- ── Notification retry queue (NFR-4) ─────────────────────────────────────────
-- Persists failed delivery jobs for exponential back-off retry.
-- Back-off schedule: attempt 1 → +30 s, attempt 2 → +120 s, attempt 3 → +480 s
-- Max 3 attempts within 10 minutes (NFR-4: "retried up to 3 times within 10 minutes").
-- Durable: survives process restarts (unlike in-memory queues).

CREATE TABLE IF NOT EXISTS notification_retry_queue (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_payload   JSONB        NOT NULL,
  channel_name    VARCHAR(20)  NOT NULL,
  title           VARCHAR(255) NOT NULL,
  message         TEXT         NOT NULL,
  attempts        SMALLINT     NOT NULL DEFAULT 0,
  next_retry_at   TIMESTAMPTZ  NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retry_queue_due
  ON notification_retry_queue(next_retry_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_retry_queue_status
  ON notification_retry_queue(status);
