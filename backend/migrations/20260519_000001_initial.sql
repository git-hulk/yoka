-- 20260519_000001_initial.sql
--
-- Initial schema. All tables STRICT — SQLite type-checks declared columns
-- instead of silently coercing.
--
-- Conventions baked in:
--   * REAL for amount / quantity (allows fractional units e.g. 7.5 coaching hours)
--   * INTEGER 0/1 for booleans (no native bool in SQLite)
--   * ISO-8601 UTC TEXT for timestamps (sortable, unambiguous)
--   * NaiveDate TEXT "YYYY-MM-DD" for expires_at (no time-of-day on expiry)
--   * Foreign keys ON DELETE RESTRICT — a package with usages must be archived,
--     not deleted. Discipline enforced at the DB layer.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS packages (
    id          TEXT    NOT NULL PRIMARY KEY,
    name        TEXT    NOT NULL,
    quantity    REAL    NOT NULL,
    time_known  INTEGER NOT NULL CHECK (time_known IN (0, 1)),
    expires_at  TEXT    NOT NULL,                                    -- YYYY-MM-DD
    notes       TEXT,
    archived_at TEXT,                                                -- ISO-8601 UTC, NULL when active
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_packages_archived_at ON packages(archived_at);

CREATE TABLE IF NOT EXISTS usages (
    id          TEXT NOT NULL PRIMARY KEY,
    package_id  TEXT NOT NULL,
    amount      REAL NOT NULL CHECK (amount > 0),
    debited_by  TEXT,                                                -- nullable: seam for multi-user later
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_usages_package_id_created_at ON usages(package_id, created_at);
