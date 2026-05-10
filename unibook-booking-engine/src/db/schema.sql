-- UniBook Booking Engine — Database Schema
-- Subsystem 3 owns: bookings, idempotency_keys
-- Run once: psql -U postgres -d unibook -f src/db/schema.sql

-- ── Bookings table ─────────────────────────────────────────────────────────
-- version column implements optimistic locking (ADR-001, Tactic 1).
-- No double-booking is possible because ConflictDetectionEngine uses
-- SELECT ... FOR UPDATE on overlapping rows before INSERT.

CREATE TABLE IF NOT EXISTS bookings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id     UUID        NOT NULL,
  user_id         UUID        NOT NULL,
  user_email      VARCHAR(255) NOT NULL,
  user_role       VARCHAR(50) NOT NULL CHECK (user_role IN ('STUDENT','FACULTY','ADMIN','IT_STAFF')),
  department      VARCHAR(255) NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  purpose         VARCHAR(500) NOT NULL,
  attendee_count  INTEGER     NOT NULL CHECK (attendee_count >= 1),
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  idempotency_key UUID        NOT NULL,
  version         INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_bookings_resource_time
  ON bookings(resource_id, start_time, end_time)
  WHERE status IN ('PENDING','APPROVED');

CREATE INDEX IF NOT EXISTS idx_bookings_user
  ON bookings(user_id);

CREATE INDEX IF NOT EXISTS idx_bookings_status
  ON bookings(status);

CREATE INDEX IF NOT EXISTS idx_bookings_idempotency_key
  ON bookings(idempotency_key);

-- ── Idempotency keys table ─────────────────────────────────────────────────
-- Guards against duplicate booking submissions within a 24-hour window.
-- IdempotencyGuard checks this table before processing any POST /bookings.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key         UUID        PRIMARY KEY,
  booking_id  UUID        NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status_code INTEGER     NOT NULL,
  response    JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON idempotency_keys(expires_at);

-- ── Booking policies config table ─────────────────────────────────────────
-- Maps resource_type_id → policy name. Loaded at startup into
-- BookingPolicyRegistry (Strategy pattern, Tactic 4 / ADR-003).

CREATE TABLE IF NOT EXISTS booking_policies (
  resource_type  VARCHAR(100) PRIMARY KEY,
  policy_name    VARCHAR(100) NOT NULL,
  policy_config  JSONB        NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed default policies
INSERT INTO booking_policies (resource_type, policy_name, policy_config) VALUES
  ('SEMINAR_ROOM', 'FIFO',     '{}'),
  ('LAB',          'PRIORITY', '{"facultyWindowMinutes": 30}'),
  ('GPU_CLUSTER',  'QUOTA',    '{"monthlyHoursPerDept": 40}'),
  ('EQUIPMENT',    'FIFO',     '{}')
ON CONFLICT (resource_type) DO NOTHING;

-- ── Quota usage tracking (for QuotaPolicy) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS quota_usage (
  department    VARCHAR(255) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  year_month    CHAR(7)      NOT NULL,  -- 'YYYY-MM'
  used_minutes  INTEGER      NOT NULL DEFAULT 0,
  PRIMARY KEY (department, resource_type, year_month)
);
