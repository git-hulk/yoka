-- 20260520_000003_categories.sql
--
-- Allow up to 3 categories per package by replacing the single nullable
-- `category TEXT` column with a JSON-array `categories TEXT` column.
-- Existing single-category values become one-element arrays; NULLs and
-- blank strings become empty arrays. The cap is enforced both by the
-- handler (with a stable error code) and by a CHECK constraint here as
-- a safety net.
--
-- Uses the table-rebuild pattern (same as 20260520_000002) so the new
-- CHECK constraints apply uniformly.

PRAGMA foreign_keys = OFF;

CREATE TABLE packages_new (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    quantity      REAL,
    tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('units','hours','duration')),
    start_date    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    notes         TEXT,
    categories    TEXT NOT NULL DEFAULT '[]'
                  CHECK (json_valid(categories)
                     AND json_type(categories) = 'array'
                     AND json_array_length(categories) <= 3),
    price_cents   INTEGER,
    currency      TEXT NOT NULL,
    archived_at   TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((tracking_mode = 'duration' AND quantity IS NULL)
        OR (tracking_mode <> 'duration' AND quantity IS NOT NULL AND quantity > 0))
) STRICT;

INSERT INTO packages_new (id, name, quantity, tracking_mode, start_date, expires_at,
                          notes, categories, price_cents, currency,
                          archived_at, created_at, updated_at)
SELECT id, name, quantity, tracking_mode, start_date, expires_at, notes,
       CASE
           WHEN category IS NULL OR TRIM(category) = '' THEN '[]'
           ELSE json_array(category)
       END,
       price_cents, currency, archived_at, created_at, updated_at
FROM packages;

DROP TABLE packages;
ALTER TABLE packages_new RENAME TO packages;

CREATE INDEX IF NOT EXISTS idx_packages_archived_at ON packages(archived_at);

PRAGMA foreign_keys = ON;
