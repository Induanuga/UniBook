-- UniBook Approval Workflow — Database Schema
-- Subsystem 4 owns: approval_requests, approver_assignments
-- Run once: psql -U unibook -d unibook_approval -f src/db/schema.sql

-- ── Approval requests table ─────────────────────────────────────────────────
-- One row per booking that requires approval.
-- Chain of Responsibility determines currentLevel (FACULTY → ADMIN).

CREATE TABLE IF NOT EXISTS approval_requests (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID         NOT NULL UNIQUE,
  resource_id         UUID         NOT NULL,
  requester_id        UUID         NOT NULL,
  requester_email     VARCHAR(255) NOT NULL,
  requester_role      VARCHAR(50)  NOT NULL CHECK (requester_role IN ('STUDENT','FACULTY','ADMIN','IT_STAFF')),
  requester_name      VARCHAR(255) NOT NULL DEFAULT '',
  department          VARCHAR(255) NOT NULL,
  start_time          TIMESTAMPTZ  NOT NULL,
  end_time            TIMESTAMPTZ  NOT NULL,
  purpose             VARCHAR(500) NOT NULL,
  resource_name       VARCHAR(255),
  status              VARCHAR(30)  NOT NULL DEFAULT 'AWAITING_FACULTY'
                        CHECK (status IN (
                          'AWAITING_FACULTY',
                          'AWAITING_ADMIN',
                          'APPROVED',
                          'REJECTED',
                          'ALTERNATIVE_SUGGESTED'
                        )),
  current_level       VARCHAR(10)  NOT NULL DEFAULT 'FACULTY'
                        CHECK (current_level IN ('FACULTY','ADMIN')),
  decided_by_id       UUID,
  decided_by_email    VARCHAR(255),
  decision_reason     TEXT,
  alternative_slot    JSONB,        -- {startTime, endTime} if SUGGEST_ALTERNATIVE
  escalated_at        TIMESTAMPTZ,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_booking_id
  ON approval_requests(booking_id);

CREATE INDEX IF NOT EXISTS idx_approval_requests_status
  ON approval_requests(status);

CREATE INDEX IF NOT EXISTS idx_approval_requests_current_level
  ON approval_requests(current_level);

CREATE INDEX IF NOT EXISTS idx_approval_requests_created_at
  ON approval_requests(created_at);

-- ── Approver assignments table ──────────────────────────────────────────────
-- Tracks which approvers (faculty / admins) are assigned to each request.
-- "Broadcast to all, first-one-wins" model:
--   • Student booking → all active FACULTY users assigned
--   • Faculty booking → all active ADMIN users assigned
--   • Escalation: after escalationHours without faculty decision → all ADMIN assigned

CREATE TABLE IF NOT EXISTS approver_assignments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id     UUID        NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  approver_id     UUID        NOT NULL,
  approver_email  VARCHAR(255) NOT NULL,
  approver_role   VARCHAR(10) NOT NULL CHECK (approver_role IN ('FACULTY','ADMIN')),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  decided_at      TIMESTAMPTZ,
  decision        VARCHAR(25) CHECK (decision IN ('APPROVE','REJECT','SUGGEST_ALTERNATIVE'))
);

CREATE INDEX IF NOT EXISTS idx_approver_assignments_approval_id
  ON approver_assignments(approval_id);

CREATE INDEX IF NOT EXISTS idx_approver_assignments_approver_id
  ON approver_assignments(approver_id);

CREATE INDEX IF NOT EXISTS idx_approver_assignments_active
  ON approver_assignments(approval_id, is_active)
  WHERE is_active = TRUE;

-- ── Handler config table (Chain of Responsibility) ──────────────────────────
-- Defines which approver levels handle which requester roles.
-- Adding a new role requires only a new row — zero code changes (NFR-3).

CREATE TABLE IF NOT EXISTS approval_handler_config (
  id               SERIAL       PRIMARY KEY,
  requester_role   VARCHAR(50)  NOT NULL,   -- Who is booking
  approver_level   VARCHAR(10)  NOT NULL,   -- FACULTY or ADMIN
  handler_order    INTEGER      NOT NULL,   -- Chain traversal order
  description      TEXT,
  UNIQUE (requester_role, approver_level)
);

-- Default chain configuration
INSERT INTO approval_handler_config (requester_role, approver_level, handler_order, description) VALUES
  ('STUDENT',  'FACULTY', 1, 'Student bookings first go to all faculty for approval'),
  ('STUDENT',  'ADMIN',   2, 'Escalation: if faculty unresponsive > 24h, send to all admins'),
  ('FACULTY',  'ADMIN',   1, 'Faculty bookings go directly to all admins for approval'),
  ('IT_STAFF', 'ADMIN',   1, 'IT Staff bookings go directly to all admins')
ON CONFLICT (requester_role, approver_level) DO NOTHING;
