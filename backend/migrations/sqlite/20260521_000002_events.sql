-- 20260521_000002_events.sql
--
-- Calendar pivot: `usages` was a pure burn-down ledger. Replacing it with
-- `events` — a Google-Calendar-style entity that can stand alone *or* link
-- to a subscription. Only events with status='accepted' AND a non-null
-- subscription_id count toward pace calculations.
--
-- Migration:
--   1. Create `events`.
--   2. Copy every existing usage in as an accepted event. created_at
--      becomes start_at; amount and subscription_id carry over.
--   3. Drop `usages`.

CREATE TABLE IF NOT EXISTS events (
    id              TEXT NOT NULL PRIMARY KEY,
    title           TEXT,
    start_at        TEXT NOT NULL,                                        -- ISO-8601 UTC
    end_at          TEXT,                                                 -- ISO-8601 UTC, NULL for point-in-time events
    status          TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'declined')),
    subscription_id TEXT,                                                 -- NULL = standalone calendar event
    amount          REAL CHECK (amount IS NULL OR amount > 0),            -- required only when subscription_id IS NOT NULL
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE RESTRICT,
    -- A linked event must carry an amount; a standalone event must not.
    CHECK ((subscription_id IS NULL AND amount IS NULL)
        OR (subscription_id IS NOT NULL AND amount IS NOT NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_events_subscription_id_start_at
    ON events(subscription_id, start_at);
CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_status   ON events(status);

-- Carry forward historical usages. Every existing row was implicitly
-- "accepted" — the burn already happened — so we mark them as such.
INSERT INTO events (id, title, start_at, end_at, status, subscription_id, amount, notes, created_at, updated_at)
SELECT id,
       NULL                 AS title,
       created_at           AS start_at,
       NULL                 AS end_at,
       'accepted'           AS status,
       subscription_id,
       amount,
       notes,
       created_at,
       created_at           AS updated_at
FROM usages;

DROP INDEX IF EXISTS idx_usages_subscription_id_created_at;
DROP TABLE usages;
