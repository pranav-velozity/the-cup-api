-- 003: gate-pass approval workflow.
-- New tables (user_notifications, admins) are created idempotently by schema.sql.
-- Existing gate_passes tables need their column + CHECK constraint widened here.

ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS requested_by_clerk_id TEXT;

ALTER TABLE gate_passes DROP CONSTRAINT IF EXISTS gate_passes_status_check;
ALTER TABLE gate_passes ADD CONSTRAINT gate_passes_status_check
  CHECK (status IN ('unused','claimed','revoked','pending','rejected'));
