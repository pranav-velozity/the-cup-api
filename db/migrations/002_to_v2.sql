-- ============================================================
--  Migration 002 — v1 -> v2  (generalized days + offline scoring)
--  Safe to run repeatedly. No-op on a fresh v2 database.
--  Run AFTER schema.sql (which creates any missing v2 tables).
-- ============================================================

-- New team-identity columns on tournaments.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_a_emoji    TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_a_kind     TEXT NOT NULL DEFAULT 'crest';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_a_logo_url TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_b_emoji    TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_b_kind     TEXT NOT NULL DEFAULT 'crest';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_b_logo_url TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_count      INT  NOT NULL DEFAULT 2;

ALTER TABLE gate_passes ADD COLUMN IF NOT EXISTS requested_by TEXT;

-- match_id-keyed offline columns on hole_results.
ALTER TABLE hole_results ADD COLUMN IF NOT EXISTS client_ts TIMESTAMPTZ NOT NULL DEFAULT now();

-- matches: introduce day_index (0-based) alongside the legacy `day` (1-based).
ALTER TABLE matches ADD COLUMN IF NOT EXISTS day_index INT;

-- Backfill day_index from legacy `day`, and tournament_days from legacy counts,
-- only when the legacy columns still exist (i.e. upgrading a real v1 DB).
DO $$
DECLARE
  has_day        boolean;
  has_singles    boolean;
  t              record;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='matches' AND column_name='day') INTO has_day;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='tournaments' AND column_name='singles_count') INTO has_singles;

  IF has_day THEN
    EXECUTE 'UPDATE matches SET day_index = day - 1 WHERE day_index IS NULL';
  END IF;

  IF has_singles THEN
    -- One singles day (index 0) + one scramble day (index 1) per existing tournament.
    FOR t IN SELECT id, singles_count, scramble_count,
                    COALESCE(day1_points_per_hole,1) AS p1,
                    COALESCE(day2_points_per_hole,2) AS p2
             FROM tournaments LOOP
      INSERT INTO tournament_days (tournament_id, day_index, format, points_per_hole, play_all)
      VALUES (t.id, 0, 'singles', t.p1, true)
      ON CONFLICT (tournament_id, day_index) DO NOTHING;
      IF COALESCE(t.scramble_count,0) > 0 THEN
        INSERT INTO tournament_days (tournament_id, day_index, format, points_per_hole, play_all)
        VALUES (t.id, 1, 'scramble', t.p2, true)
        ON CONFLICT (tournament_id, day_index) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
END $$;

-- Make day_index required, then drop the legacy `day` column + its check.
UPDATE matches SET day_index = 0 WHERE day_index IS NULL;
ALTER TABLE matches ALTER COLUMN day_index SET NOT NULL;
ALTER TABLE matches DROP COLUMN IF EXISTS day;

-- Drop the obsolete fixed-format columns from tournaments.
ALTER TABLE tournaments DROP COLUMN IF EXISTS singles_count;
ALTER TABLE tournaments DROP COLUMN IF EXISTS scramble_count;
ALTER TABLE tournaments DROP COLUMN IF EXISTS day1_points_per_hole;
ALTER TABLE tournaments DROP COLUMN IF EXISTS day2_points_per_hole;

-- Now that day_index exists, add the day-aware match index.
CREATE INDEX IF NOT EXISTS idx_matches_day ON matches (tournament_id, day_index, ordinal);
