-- 005: split the single `format` enum into two axes:
--        scoring = 'match' | 'stroke'
--        format  = 'singles' | 'scramble'   (team format / side size)
--
-- The legacy value 'scramble_stroke' becomes (scoring='stroke', format='scramble').
-- Safe + idempotent; runs before any production data exists.

ALTER TABLE tournament_days ADD COLUMN IF NOT EXISTS scoring TEXT NOT NULL DEFAULT 'match';

-- Backfill scoring from the legacy combined format, then collapse the format
-- column back to the team-format axis only.
UPDATE tournament_days SET scoring = 'stroke' WHERE format = 'scramble_stroke';
UPDATE tournament_days SET format  = 'scramble' WHERE format = 'scramble_stroke';

ALTER TABLE tournament_days DROP CONSTRAINT IF EXISTS tournament_days_scoring_check;
ALTER TABLE tournament_days ADD CONSTRAINT tournament_days_scoring_check
  CHECK (scoring IN ('match','stroke'));

ALTER TABLE tournament_days DROP CONSTRAINT IF EXISTS tournament_days_format_check;
ALTER TABLE tournament_days ADD CONSTRAINT tournament_days_format_check
  CHECK (format IN ('singles','scramble'));
