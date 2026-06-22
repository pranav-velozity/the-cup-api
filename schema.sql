-- ============================================================
--  THE CUP / TOTO — database schema  (PostgreSQL / Render)   v2
--
--  Identity model (all personas via Clerk phone OTP):
--    Admin / organizers / players all sign in with a verified phone.
--    We store only Clerk user ids (text). The ROSTER is the
--    authorization check (is this verified number invited, which team?).
--
--  v2 generalizes the format: a tournament has 1..4 DAYS, each day is
--  singles or scramble with its own points-per-hole and a "play all 18
--  vs end-on-clinch" flag. Scoring is per hole and offline-safe.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ------------------------------------------------------------
-- GATE PASSES  (admin mints; single-use; redeemed by an organizer)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gate_passes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 CHAR(5)     NOT NULL UNIQUE,
    status               TEXT        NOT NULL DEFAULT 'unused'
                         CHECK (status IN ('unused','claimed','revoked')),
    created_by_clerk_id  TEXT        NOT NULL,
    claimed_by_clerk_id  TEXT,
    tournament_id        UUID,
    requested_by         TEXT,                  -- name from self-serve "Request access"
    note                 TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at           TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- TOURNAMENTS  (each has its own 5-digit player join code)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournaments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 CHAR(5)     NOT NULL UNIQUE,
    name                 TEXT        NOT NULL,
    organizer_clerk_id   TEXT        NOT NULL,
    gate_pass_id         UUID        NOT NULL REFERENCES gate_passes(id),

    team_a_name          TEXT        NOT NULL DEFAULT 'Team A',
    team_a_color         TEXT        NOT NULL DEFAULT '#2E7D5B',  -- brand green
    team_a_emoji         TEXT,
    team_a_kind          TEXT        NOT NULL DEFAULT 'crest',    -- crest | emoji | logo
    team_a_logo_url      TEXT,
    team_b_name          TEXT        NOT NULL DEFAULT 'Team B',
    team_b_color         TEXT        NOT NULL DEFAULT '#B68A2E',  -- brand gold
    team_b_emoji         TEXT,
    team_b_kind          TEXT        NOT NULL DEFAULT 'crest',
    team_b_logo_url      TEXT,

    team_count           INT         NOT NULL DEFAULT 2 CHECK (team_count IN (2)),

    notify_settings      JSONB       NOT NULL DEFAULT
        '{"hole_won":true,"match_final":true,"lead_change":true,"day_end":true}'::jsonb,

    status               TEXT        NOT NULL DEFAULT 'setup'
                         CHECK (status IN ('setup','live','final')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- close the circular reference (gate_passes.tournament_id -> tournaments.id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'gate_passes_tournament_fk'
  ) THEN
    ALTER TABLE gate_passes
      ADD CONSTRAINT gate_passes_tournament_fk
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- TOURNAMENT DAYS  (the generalized format: 1..4 days)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournament_days (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id    UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    day_index        INT  NOT NULL CHECK (day_index BETWEEN 0 AND 3),  -- 0-based
    format           TEXT NOT NULL CHECK (format IN ('singles','scramble')),
    points_per_hole  INT  NOT NULL DEFAULT 1 CHECK (points_per_hole BETWEEN 1 AND 10),
    play_all         BOOLEAN NOT NULL DEFAULT true,  -- true = all 18; false = end on clinch
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, day_index)
);

-- ------------------------------------------------------------
-- ROSTER  (phone numbers the organizer pre-loads = the gate)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roster_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team           CHAR(1) NOT NULL CHECK (team IN ('A','B')),
    planned_name   TEXT,
    phone          TEXT NOT NULL,                 -- E.164 normalized
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, phone)
);

-- ------------------------------------------------------------
-- REGISTRATIONS  (players who actually joined)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registrations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    roster_entry_id UUID REFERENCES roster_entries(id),
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL,                 -- E.164, verified by Clerk OTP
    team            CHAR(1) NOT NULL CHECK (team IN ('A','B')),
    notify_enabled  BOOLEAN NOT NULL DEFAULT true,
    player_clerk_id TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, phone),
    UNIQUE (tournament_id, player_clerk_id)
);

-- ------------------------------------------------------------
-- MATCHES  (belong to a day; side_a/side_b hold roster_entry ids)
--   singles  -> 1 id per side;  scramble -> 2 ids per side.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    day_index      INT  NOT NULL CHECK (day_index BETWEEN 0 AND 3),
    kind           TEXT NOT NULL CHECK (kind IN ('singles','scramble')),
    label          TEXT NOT NULL,
    ordinal        INT  NOT NULL,
    side_a         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [roster_entry_id, ...]
    side_b         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, day_index, ordinal)
);

-- ------------------------------------------------------------
-- HOLE RESULTS  (one row per scored hole — the offline-safe write target)
--   UNIQUE(match_id, hole) makes every write an idempotent upsert.
--   client_ts drives last-writer-wins so queued/retried writes are safe.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hole_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    hole        INT  NOT NULL CHECK (hole BETWEEN 1 AND 18),
    result      CHAR(1) CHECK (result IN ('A','B','T')),  -- null = cleared
    updated_by  TEXT,                                      -- registration id / clerk id
    client_ts   TIMESTAMPTZ NOT NULL DEFAULT now(),        -- client clock at tap time
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),        -- server write time
    UNIQUE (match_id, hole)
);

-- ------------------------------------------------------------
-- MATCH EVENTS  (append-only feed: powers Latest ticker + Last-9 strip)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    match_id       UUID REFERENCES matches(id) ON DELETE SET NULL,
    hole           INT,
    text           TEXT NOT NULL,
    dot            TEXT,                                    -- team color or null (halved)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- PUSH SUBSCRIPTIONS  (Web Push endpoints per player device)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (registration_id, endpoint)
);

-- ------------------------------------------------------------
-- NOTIFICATIONS  (in-app feed log; also source for push sends)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    type           TEXT NOT NULL
                   CHECK (type IN ('hole_won','match_final','lead_change','day_end')),
    audience       TEXT NOT NULL DEFAULT 'all',
    match_id       UUID REFERENCES matches(id) ON DELETE SET NULL,
    title          TEXT NOT NULL,
    body           TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tournaments_code         ON tournaments (code);
CREATE INDEX IF NOT EXISTS idx_gate_passes_code         ON gate_passes (code);
CREATE INDEX IF NOT EXISTS idx_days_tournament          ON tournament_days (tournament_id, day_index);
CREATE INDEX IF NOT EXISTS idx_roster_tournament        ON roster_entries (tournament_id);
CREATE INDEX IF NOT EXISTS idx_registrations_tournament ON registrations (tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_tournament       ON matches (tournament_id, day_index, ordinal);
CREATE INDEX IF NOT EXISTS idx_hole_results_match       ON hole_results (match_id);
CREATE INDEX IF NOT EXISTS idx_events_tournament        ON match_events (tournament_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_tournament ON notifications (tournament_id, created_at DESC);
