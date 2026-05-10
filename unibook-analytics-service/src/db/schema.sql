-- UniBook Analytics & Reporting Service — Database Schema (Subsystem 6)
-- Run via: npm run db:migrate
--
-- Design: analytics_events is the append-only event log.
-- utilisation_snapshots is a materialised view refreshed every 5 minutes (FR-7).
-- Aggregation queries run against snapshots — never against transactional tables (NFR-1).

-- ── Raw analytics event log ──────────────────────────────────────────────────
-- One row per booking lifecycle event consumed from the EventBus.
-- Append-only; never updated.

CREATE TABLE IF NOT EXISTS analytics_events (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type    VARCHAR(60)  NOT NULL
                  CHECK (event_type IN (
                    'BookingApproved',
                    'BookingCancelled',
                    'BookingSubmitted',
                    'BookingRejected'
                  )),
  booking_id    UUID         NOT NULL,
  resource_id   UUID         NOT NULL,
  user_id       UUID         NOT NULL,
  department    VARCHAR(100) NOT NULL DEFAULT '',
  start_time    TIMESTAMPTZ  NOT NULL,
  end_time      TIMESTAMPTZ  NOT NULL,
  recorded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  correlation_id VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type
  ON analytics_events(event_type);

CREATE INDEX IF NOT EXISTS idx_analytics_events_resource_id
  ON analytics_events(resource_id);

CREATE INDEX IF NOT EXISTS idx_analytics_events_department
  ON analytics_events(department);

CREATE INDEX IF NOT EXISTS idx_analytics_events_recorded_at
  ON analytics_events(recorded_at DESC);

-- Unique constraint so backfill and webhook are both idempotent
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_booking_event
  ON analytics_events(booking_id, event_type);

-- ── Utilisation snapshots (materialised view model) ──────────────────────────
-- Pre-aggregated (hour, day_of_week) buckets per resource.
-- Uses CREATE TABLE IF NOT EXISTS — safe to re-run without data loss.

CREATE TABLE IF NOT EXISTS utilisation_snapshots (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id   UUID         NOT NULL,
  department    VARCHAR(100) NOT NULL DEFAULT '',
  hour          SMALLINT     NOT NULL CHECK (hour BETWEEN 0 AND 23),
  day_of_week   SMALLINT     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  booking_count INTEGER      NOT NULL DEFAULT 0,
  snapshot_date DATE         NOT NULL DEFAULT CURRENT_DATE,
  refreshed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_utilisation_snapshots_unique
  ON utilisation_snapshots(resource_id, hour, day_of_week, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_utilisation_snapshots_resource
  ON utilisation_snapshots(resource_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_utilisation_snapshots_department
  ON utilisation_snapshots(department, snapshot_date);
