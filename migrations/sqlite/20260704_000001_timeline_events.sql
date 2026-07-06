-- 20260704_000001_timeline_events.sql
--
-- User-authored key dates shown on the Timeline page alongside the derived
-- subscription pay events. Group-scoped from birth (unlike the pre-auth
-- tables, no NULL-able backfill window is needed).
--
-- Conventions copied from earlier migrations:
--   * STRICT table, type-checked.
--   * NaiveDate TEXT 'YYYY-MM-DD' for the event date; ISO-8601 UTC TEXT for
--     row timestamps.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS timeline_events (
    id          TEXT NOT NULL PRIMARY KEY,
    group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title       TEXT NOT NULL CHECK (length(title) > 0),
    occurred_on TEXT NOT NULL,                                          -- YYYY-MM-DD
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- The only read path is "this group's events inside one year", so a single
-- composite index covers it.
CREATE INDEX IF NOT EXISTS idx_timeline_events_group_date
    ON timeline_events(group_id, occurred_on);
