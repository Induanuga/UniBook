-- ============================================================
-- UniBook Resource Catalogue Schema — Subsystem 2
-- Run with: npm run db:migrate
-- ============================================================

-- Resource Types — master lookup (SEMINAR_ROOM, LAB, GPU_CLUSTER, EQUIPMENT)
CREATE TABLE IF NOT EXISTS resource_types (
  id          VARCHAR(50)  PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed built-in resource types (idempotent)
INSERT INTO resource_types (id, name, description) VALUES
  ('SEMINAR_ROOM', 'Seminar Room',  'General-purpose teaching and meeting rooms'),
  ('LAB',          'Laboratory',    'Computer labs and specialised research labs'),
  ('GPU_CLUSTER',  'GPU Cluster',   'High-performance GPU compute nodes for ML/research'),
  ('EQUIPMENT',    'Equipment',     'Portable equipment: cameras, projectors, sensors')
ON CONFLICT (id) DO NOTHING;

-- Resources — master catalogue of bookable university assets (FR-1)
CREATE TABLE IF NOT EXISTS resources (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  type_id     VARCHAR(50)  NOT NULL REFERENCES resource_types(id),
  location    VARCHAR(200) NOT NULL DEFAULT '',
  capacity    INTEGER      NOT NULL DEFAULT 1 CHECK (capacity >= 1),
  description TEXT         NOT NULL DEFAULT '',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  amenities   JSONB        NOT NULL DEFAULT '[]',
  version     INTEGER      NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Maintenance Windows — blocks resources from being booked (FR-1, PUT /resources/:id/maintenance)
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID        NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  reason      TEXT        NOT NULL DEFAULT '',
  created_by  VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_maintenance_order CHECK (end_time > start_time)
);

-- ── Performance Indexes (NFR-1: P95 <= 500ms, NFR-5: survive 10x spike) ──────

-- Primary search filters (FR-1: search by type, location, capacity)
CREATE INDEX IF NOT EXISTS idx_resources_type_id    ON resources(type_id);
CREATE INDEX IF NOT EXISTS idx_resources_capacity   ON resources(capacity);
CREATE INDEX IF NOT EXISTS idx_resources_is_active  ON resources(is_active);
CREATE INDEX IF NOT EXISTS idx_resources_location   ON resources USING gin(to_tsvector('english', location));

-- Maintenance lookup for availability checks
CREATE INDEX IF NOT EXISTS idx_maintenance_resource_time
  ON maintenance_windows(resource_id, start_time, end_time);

-- ── Seed sample data (development only) ──────────────────────────────────────
INSERT INTO resources (id, name, type_id, location, capacity, description, amenities) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Seminar Room A101', 'SEMINAR_ROOM', 'Block A, Floor 1', 30,  'Standard seminar room with projector', '["projector","whiteboard","ac"]'),
  ('a0000000-0000-0000-0000-000000000002', 'Seminar Room A102', 'SEMINAR_ROOM', 'Block A, Floor 1', 20,  'Small seminar room',                  '["whiteboard","ac"]'),
  ('a0000000-0000-0000-0000-000000000003', 'Computer Lab B201', 'LAB',          'Block B, Floor 2', 40,  '40-seat computer lab',                '["computers","ac","projector"]'),
  ('a0000000-0000-0000-0000-000000000004', 'Research Lab B301', 'LAB',          'Block B, Floor 3', 10,  'Advanced research lab',               '["microscopes","ac"]'),
  ('a0000000-0000-0000-0000-000000000005', 'GPU Cluster Node 1','GPU_CLUSTER',  'Data Center DC1',  1,   '8x A100 GPU cluster node',            '["gpu_a100","infiniband","nvme"]'),
  ('a0000000-0000-0000-0000-000000000006', 'GPU Cluster Node 2','GPU_CLUSTER',  'Data Center DC1',  1,   '8x A100 GPU cluster node',            '["gpu_a100","infiniband","nvme"]'),
  ('a0000000-0000-0000-0000-000000000007', 'Projector Kit 01',  'EQUIPMENT',    'Equipment Store',  1,   '4K projector with stand',             '["4k","hdmi","vga"]'),
  ('a0000000-0000-0000-0000-000000000008', 'Seminar Room C101', 'SEMINAR_ROOM', 'Block C, Floor 1', 50,  'Large lecture room',                  '["projector","microphone","ac","recording"]')
ON CONFLICT (id) DO NOTHING;
