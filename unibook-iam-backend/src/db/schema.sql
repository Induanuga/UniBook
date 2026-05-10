-- UniBook IAM Subsystem — Database Schema
-- Run once: psql -U postgres -d unibook -f schema.sql

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  name          VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL CHECK (role IN ('STUDENT', 'FACULTY', 'ADMIN', 'IT_STAFF')),
  department    VARCHAR(255),
  student_id    VARCHAR(100),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO roles (name, description) VALUES
  ('STUDENT',  'Can browse and book resources'),
  ('FACULTY',  'Can book resources and approve student requests'),
  ('ADMIN',    'Full access to analytics, audit logs, and resource management'),
  ('IT_STAFF', 'Can register resources and schedule maintenance')
ON CONFLICT (name) DO NOTHING;

-- Audit log table (immutable)
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor           VARCHAR(255) NOT NULL,
  actor_email     VARCHAR(255) NOT NULL,
  endpoint        VARCHAR(500) NOT NULL,
  method          VARCHAR(10) NOT NULL,
  action          VARCHAR(100) NOT NULL,
  role_required   VARCHAR(50),
  role_presented  VARCHAR(50),
  ip_address      VARCHAR(50),
  user_agent      TEXT,
  success         BOOLEAN NOT NULL,
  metadata        JSONB,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor     ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);

-- FIX: Revoked tokens table — persists blacklist across server restarts.
-- Both access token jti and refresh token jti are stored here on logout.
-- Without this, a server restart would forget all revocations and CAS
-- users who logged out could log back in with their old refresh token.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,          -- UUID from token's jti field
  expires_at TIMESTAMPTZ NOT NULL,      -- token's natural expiry (for cleanup)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index so the server can quickly clean expired tokens
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);
