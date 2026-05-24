-- 20260522_000001_finance.sql
--
-- Family-finance tables. Three sources feed the monthly ledger:
--
--   1. Subscriptions (existing) — each row is a one-time outflow on its
--      `start_date` for `price_cents` in `currency`. No schema change here;
--      the ledger projection reads subscriptions verbatim.
--   2. One-off expenses — this `expenses` table.
--   3. Recurring expenses — the `recurring_expenses` rule table; each cycle
--      is materialized in `domain::ledger::project_month`, not persisted.
--
-- Plus per-month budgets keyed by (category, currency).
--
-- Conventions copied from earlier migrations:
--   * STRICT tables, type-checked.
--   * `amount_cents` as INTEGER — currency-aware minor units (USD/SGD/CNY = 2,
--     JPY = 0), matching the precedent set in 20260519_000003_currency.sql.
--   * ISO-8601 UTC TEXT for timestamps, NaiveDate TEXT 'YYYY-MM-DD' for dates.
--   * Currency CHECK identical to subscriptions.

PRAGMA foreign_keys = ON;

-- One-off expense entries.
--
-- `category` is a single TEXT (not a JSON array like subscriptions). Ledger
-- attribution requires exactly one category per entry; multi-tag is a
-- subscription-only convenience. Empty string is allowed and rendered as
-- "Uncategorized" in the UI.
CREATE TABLE IF NOT EXISTS expenses (
    id            TEXT    NOT NULL PRIMARY KEY,
    occurred_on   TEXT    NOT NULL,                                     -- YYYY-MM-DD
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    currency      TEXT    NOT NULL CHECK (currency IN ('USD', 'SGD', 'CNY', 'JPY')),
    category      TEXT    NOT NULL DEFAULT '',
    notes         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_expenses_occurred_on  ON expenses(occurred_on);
CREATE INDEX IF NOT EXISTS idx_expenses_currency_cat ON expenses(currency, category);

-- Recurring-expense rules. Each row defines a series; concrete instances
-- are derived on read (see `domain::ledger::project_month`), so we don't
-- store per-cycle rows. Cadence is intentionally narrow — only `monthly`
-- and `yearly` cover the recurring-bill use case.
CREATE TABLE IF NOT EXISTS recurring_expenses (
    id            TEXT    NOT NULL PRIMARY KEY,
    name          TEXT    NOT NULL,
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    currency      TEXT    NOT NULL CHECK (currency IN ('USD', 'SGD', 'CNY', 'JPY')),
    category      TEXT    NOT NULL DEFAULT '',
    cadence       TEXT    NOT NULL CHECK (cadence IN ('monthly', 'yearly')),
    start_date    TEXT    NOT NULL,                                     -- YYYY-MM-DD
    end_date      TEXT,                                                 -- YYYY-MM-DD, inclusive
    notes         TEXT,
    archived_at   TEXT,                                                 -- ISO-8601 UTC, NULL when active
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (end_date IS NULL OR end_date >= start_date)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_archived ON recurring_expenses(archived_at);

-- Per-month budgets keyed by (month, category, currency). `month` is stored
-- as 'YYYY-MM' for cheap equality lookups (no date math needed).
-- A category of '' is allowed — budgets the "Uncategorized" bucket.
CREATE TABLE IF NOT EXISTS budgets (
    id            TEXT    NOT NULL PRIMARY KEY,
    month         TEXT    NOT NULL CHECK (length(month) = 7),           -- YYYY-MM
    category      TEXT    NOT NULL,
    currency      TEXT    NOT NULL CHECK (currency IN ('USD', 'SGD', 'CNY', 'JPY')),
    amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
    notes         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (month, category, currency)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(month);
