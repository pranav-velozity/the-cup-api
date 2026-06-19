-- ============================================================
--  THE CUP — database schema (PostgreSQL / Render)
--  Foundation: two-code gate flow + scoring + notifications
--
--  Identity model (all three personas via Clerk):
--    - Admin (you) and Organizers: Clerk email sign-in.
--    - Players: Clerk phone sign-in with SMS OTP (verified number).
--    We store only Clerk user ids (text), never passwords or OTPs.
--    The roster is the AUTHORIZATION check (is this verified number
--    invited, and on which team?), not the identity check.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- ------------------------------------------------------------
-- GATE PASSES  (minted by admin, single-use, one per tournament)
-- ------------------------------------------------------------
CREATE TABLE gate_passes (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 CHAR(5)     NOT NULL UNIQUE,          -- "00000".."99999"
    status               TEXT        NOT NULL DEFAULT 'unused' -- unused | claimed | revoked
                         CHECK (status IN ('unused','claimed','revoked')),
    created_by_clerk_id  TEXT        NOT NULL,                 -- admin who minted it
    claimed_by_clerk_id  TEXT,                                 -- organizer who redeemed it
    tournament_id        UUID,                                 -- set on claim (FK added below)
    note                 TEXT,                                 -- e.g. "for Dave's club cup"
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at           TIMESTAMPTZ,
    expires_at           TIMESTAMPTZ                            -- optional expiry
);

-- ------------------------------------------------------------
-- TOURNAMENTS  (each has its own 5-digit player join code)
-- ------------------------------------------------------------
CREATE TABLE tournaments (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 CHAR(5)     NOT NULL UNIQUE,          -- players join with this
    name                 TEXT        NOT NULL,
    organizer_clerk_id   TEXT        NOT NULL,
    gate_pass_id         UUID        NOT NULL REFERENCES gate_passes(id),

    team_a_name          TEXT        NOT NULL DEFAULT 'Team A',
    team_a_color         TEXT        NOT NULL DEFAULT '#3D7BFF',
    team_b_name          TEXT        NOT NULL DEFAULT 'Team B',
    team_b_color         TEXT        NOT NULL DEFAULT '#FF5C5C',

    singles_count        INT         NOT NULL DEFAULT 18,
    scramble_count       INT         NOT NULL DEFAULT 9,
    day1_points_per_hole INT         NOT NULL DEFAULT 1,
    day2_points_per_hole INT         NOT NULL DEFAULT 2,

    -- organizer-chosen notification triggers (all on by default)
    notify_settings      JSONB       NOT NULL DEFAULT
        '{"hole_won":true,"match_final":true,"lead_change":true,"day_end":true}'::jsonb,

    status               TEXT        NOT NULL DEFAULT 'setup'  -- setup | live | final
                         CHECK (status IN ('setup','live','final')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- close the circular reference now that tournaments exists
ALTER TABLE gate_passes
    ADD CONSTRAINT gate_passes_tournament_fk
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id);

-- ------------------------------------------------------------
-- ROSTER  (phone numbers the organizer pre-loads = the gate)
-- ------------------------------------------------------------
CREATE TABLE roster_entries (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team           CHAR(1) NOT NULL CHECK (team IN ('A','B')),
    planned_name   TEXT,                          -- organizer's label, optional
    phone          TEXT NOT NULL,                 -- store E.164 normalized
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, phone)
);

-- ------------------------------------------------------------
-- REGISTRATIONS  (players who actually joined)
-- ------------------------------------------------------------
CREATE TABLE registrations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    roster_entry_id UUID REFERENCES roster_entries(id),
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL,                  -- E.164, verified by Clerk OTP
    team            CHAR(1) NOT NULL CHECK (team IN ('A','B')),
    notify_enabled  BOOLEAN NOT NULL DEFAULT true,  -- player master mute
    player_clerk_id TEXT NOT NULL,                  -- verified Clerk user id
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, phone),
    UNIQUE (tournament_id, player_clerk_id)
);

-- ------------------------------------------------------------
-- MATCHES  (18 singles + 9 scramble, etc.)
-- ------------------------------------------------------------
CREATE TABLE matches (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    day            INT  NOT NULL CHECK (day IN (1,2)),
    kind           TEXT NOT NULL CHECK (kind IN ('singles','scramble')),
    label          TEXT NOT NULL,                  -- "Match 1"
    ordinal        INT  NOT NULL,                  -- ordering within the day
    -- denormalized player names per side (1 for singles, 2 for scramble)
    side_a         JSONB NOT NULL DEFAULT '[]'::jsonb,
    side_b         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tournament_id, day, ordinal)
);

-- ------------------------------------------------------------
-- HOLE RESULTS  (one row per scored hole; concurrency-safe per match)
-- ------------------------------------------------------------
CREATE TABLE hole_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    hole        INT  NOT NULL CHECK (hole BETWEEN 1 AND 18),
    result      CHAR(1) CHECK (result IN ('A','B','T')),  -- null = not yet played
    updated_by  TEXT,                                      -- registration id / clerk id
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (match_id, hole)
);

-- ------------------------------------------------------------
-- PUSH SUBSCRIPTIONS  (Web Push endpoints per player device)
-- ------------------------------------------------------------
CREATE TABLE push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    endpoint        TEXT NOT NULL,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (registration_id, endpoint)
);

-- ------------------------------------------------------------
-- NOTIFICATIONS  (in-app feed log; also the source for push sends)
-- ------------------------------------------------------------
CREATE TABLE notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    type           TEXT NOT NULL                      -- hole_won | match_final | lead_change | day_end
                   CHECK (type IN ('hole_won','match_final','lead_change','day_end')),
    audience       TEXT NOT NULL DEFAULT 'all',       -- 'all' | 'A' | 'B' | 'match:<id>'
    match_id       UUID REFERENCES matches(id) ON DELETE SET NULL,
    title          TEXT NOT NULL,
    body           TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
CREATE INDEX idx_tournaments_code        ON tournaments (code);
CREATE INDEX idx_gate_passes_code        ON gate_passes (code);
CREATE INDEX idx_roster_tournament       ON roster_entries (tournament_id);
CREATE INDEX idx_registrations_tournament ON registrations (tournament_id);
CREATE INDEX idx_matches_tournament      ON matches (tournament_id);
CREATE INDEX idx_hole_results_match      ON hole_results (match_id);
CREATE INDEX idx_notifications_tournament ON notifications (tournament_id, created_at DESC);
