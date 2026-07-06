-- 20260521_000003_recurring_events.sql
--
-- Recurring events. A row with `recurrence_rule` set is a "series root": its
-- start_at is the first instance, and subsequent instances are computed at
-- read time from the rule. Per-instance status overrides live in a separate
-- `event_exceptions` table; the absence of an exception means the instance
-- inherits the series root's status.
--
-- `recurrence_rule` is a small JSON document:
--   { "freq":"daily"|"weekly"|"monthly",
--     "byweekday": ["MO","TU",...]   (weekly only; null = parent's weekday),
--     "until": "YYYY-MM-DD"           (exclusive end date, optional),
--     "count": <positive integer>     (max instance count incl. parent, optional) }
-- Exactly zero or one of `until` / `count` may be set.
--
-- Composite IDs of the form `<parent_id>:YYYY-MM-DD` identify a virtual
-- instance at the HTTP layer. The date is the UTC date of the instance's
-- start_at — unambiguous, no timezone drift.

ALTER TABLE events ADD COLUMN recurrence_rule TEXT;

CREATE TABLE IF NOT EXISTS event_exceptions (
    id             TEXT NOT NULL PRIMARY KEY,
    parent_id      TEXT NOT NULL,
    -- UTC date of the virtual instance this exception modifies. Matches the
    -- date portion of the instance's expanded start_at.
    instance_date  TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (parent_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE (parent_id, instance_date)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_event_exceptions_parent
    ON event_exceptions(parent_id);
