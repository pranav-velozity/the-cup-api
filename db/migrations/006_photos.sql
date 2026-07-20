-- 006: photo gallery table (images live in R2; these rows are the source of truth).
CREATE TABLE IF NOT EXISTS photos (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id      UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    uploader_clerk_id  TEXT NOT NULL,
    uploader_name      TEXT,
    url                TEXT NOT NULL,
    thumb_url          TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_tournament_idx ON photos (tournament_id, created_at DESC);
