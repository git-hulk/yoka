-- 20260614_000001_users_and_groups.sql
--
-- Multi-user / group model. Resources (subscriptions, events, expenses,
-- recurring expenses, budgets) become group-scoped; users belong to one
-- or more groups via `group_members`, each with a role.
--
-- Conventions match earlier migrations:
--   * STRICT tables.
--   * ISO-8601 UTC TEXT for timestamps.
--   * Foreign keys enforced (see db::connect).
--
-- The `group_id` column on existing resource tables is added NULL-able at
-- the SQL layer — SQLite can't add a NOT NULL column without a DEFAULT, and
-- a placeholder default would lie. The application layer always supplies
-- `group_id` on every insert (the active group from the caller's session),
-- so post-migration rows are never NULL. Any pre-existing rows in a DB that
-- predates this migration would be NULL-scoped and therefore invisible —
-- a fresh deploy has nothing to backfill, and self-signup creates the first
-- user + their "Personal" group with no admin intervention.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
--
-- `email` is case-insensitive via COLLATE NOCASE, so the UNIQUE index treats
-- "Alice@x.com" and "alice@x.com" as the same address (and lookups by email
-- don't need to lower() the input).
CREATE TABLE IF NOT EXISTS users (
    id            TEXT NOT NULL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- ---------------------------------------------------------------------------
-- group_members  (membership + role)
-- ---------------------------------------------------------------------------
--
-- Partial unique index `idx_group_members_one_owner` enforces the
-- "exactly one owner per group" invariant at the storage layer, so role
-- changes can race without ever ending up with two owners.
CREATE TABLE IF NOT EXISTS group_members (
    id         TEXT NOT NULL PRIMARY KEY,
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin', 'owner')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (group_id, user_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_one_owner
    ON group_members(group_id) WHERE role = 'owner';

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------
--
-- Shareable-link invites. `token` is the opaque secret embedded in the
-- accept-invite URL; one row's lifecycle is create → (accepted_at | revoked_at).
-- Owner-role invites are forbidden by CHECK — ownership is transferred, not
-- invited.
CREATE TABLE IF NOT EXISTS invitations (
    id          TEXT NOT NULL PRIMARY KEY,
    group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    email       TEXT NOT NULL COLLATE NOCASE,
    role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
    token       TEXT NOT NULL UNIQUE,
    invited_by  TEXT NOT NULL REFERENCES users(id),
    expires_at  TEXT NOT NULL,
    accepted_at TEXT,
    revoked_at  TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_invitations_group_pending
    ON invitations(group_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
--
-- The `id` IS the opaque session token stored in the `yoka_session` cookie;
-- the server hands it out at login and looks it up on every request. Plain
-- text on purpose — a stolen DB compromises sessions either way, and JWT-style
-- self-validating tokens trade revocability for stateless auth which this app
-- doesn't need.
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT NOT NULL PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    active_group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at      TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- group_id on existing resource tables
-- ---------------------------------------------------------------------------
ALTER TABLE subscriptions      ADD COLUMN group_id TEXT REFERENCES groups(id);
ALTER TABLE events             ADD COLUMN group_id TEXT REFERENCES groups(id);
ALTER TABLE event_exceptions   ADD COLUMN group_id TEXT REFERENCES groups(id);
ALTER TABLE expenses           ADD COLUMN group_id TEXT REFERENCES groups(id);
ALTER TABLE recurring_expenses ADD COLUMN group_id TEXT REFERENCES groups(id);
ALTER TABLE budgets            ADD COLUMN group_id TEXT REFERENCES groups(id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_group       ON subscriptions(group_id);
CREATE INDEX IF NOT EXISTS idx_events_group              ON events(group_id);
CREATE INDEX IF NOT EXISTS idx_event_exceptions_group    ON event_exceptions(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group            ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_group  ON recurring_expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_budgets_group             ON budgets(group_id);
