-- 20260520_000002_tracking_mode.sql
--
-- Replace the two-valued `time_known` boolean with a three-valued
-- `tracking_mode` enum: units | hours | duration. Duration packs measure
-- progress from the start_date → expires_at window alone — no quantity, no
-- usages. To support that, `quantity` becomes nullable, and a CHECK
-- constraint enforces the invariant `tracking_mode = 'duration' ↔ quantity
-- IS NULL`.
--
-- SQLite's ALTER TABLE can drop a column but can't relax NOT NULL, so we
-- use the table-rebuild pattern: create _new with the target shape, copy,
-- drop, rename. Foreign keys from `usages.package_id` survive because we
-- rename rather than recreate the parent.

PRAGMA foreign_keys = OFF;

CREATE TABLE packages_new (
    id            TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    quantity      REAL,                                                 -- nullable: NULL for duration mode
    tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('units','hours','duration')),
    start_date    TEXT NOT NULL,                                        -- YYYY-MM-DD
    expires_at    TEXT NOT NULL,                                        -- YYYY-MM-DD
    notes         TEXT,
    category      TEXT,
    price_cents   INTEGER,
    currency      TEXT NOT NULL,
    archived_at   TEXT,                                                 -- ISO-8601 UTC, NULL when active
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((tracking_mode = 'duration' AND quantity IS NULL)
        OR (tracking_mode <> 'duration' AND quantity IS NOT NULL AND quantity > 0))
) STRICT;

INSERT INTO packages_new (id, name, quantity, tracking_mode, start_date, expires_at,
                          notes, category, price_cents, currency,
                          archived_at, created_at, updated_at)
SELECT id, name, quantity,
       CASE WHEN time_known = 1 THEN 'hours' ELSE 'units' END,
       start_date, expires_at, notes, category, price_cents, currency,
       archived_at, created_at, updated_at
FROM packages;

DROP TABLE packages;
ALTER TABLE packages_new RENAME TO packages;

CREATE INDEX IF NOT EXISTS idx_packages_archived_at ON packages(archived_at);

PRAGMA foreign_keys = ON;
