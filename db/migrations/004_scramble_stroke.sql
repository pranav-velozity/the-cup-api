-- 004: scramble stroke-differential format.
-- Adds a new day format and per-hole stroke columns (with independent
-- last-writer-wins timestamps so each pair's side can't clobber the other).

ALTER TABLE tournament_days DROP CONSTRAINT IF EXISTS tournament_days_format_check;
ALTER TABLE tournament_days ADD CONSTRAINT tournament_days_format_check
  CHECK (format IN ('singles','scramble','scramble_stroke'));

ALTER TABLE hole_results ADD COLUMN IF NOT EXISTS strokes_a   INT;
ALTER TABLE hole_results ADD COLUMN IF NOT EXISTS strokes_b   INT;
ALTER TABLE hole_results ADD COLUMN IF NOT EXISTS client_ts_a TIMESTAMPTZ;
ALTER TABLE hole_results ADD COLUMN IF NOT EXISTS client_ts_b TIMESTAMPTZ;
