-- 20260519_000003_currency.sql
--
-- Add a currency code to packages so prices aren't implicitly USD.
--
-- Storage: ISO-4217 codes ('USD', 'SGD', 'CNY', 'JPY'). Constrained via
-- CHECK rather than a lookup table — the set is small, fixed, and rarely
-- changes; a foreign key would cost a join on every read.
--
-- `price_cents` interpretation is currency-aware:
--   * USD/SGD/CNY (2-minor-unit): 18000 = 180.00 (cents).
--   * JPY         (0-minor-unit): 18000 = ¥18000 (yen). JPY has no fractional
--                                 subunit, so the column stores yen directly.
-- The frontend uses Intl.NumberFormat with the currency code, which knows
-- the minor-unit factor and renders correctly.
--
-- Existing rows get 'USD' as the backfill — that matches the implicit
-- behavior before this migration.

ALTER TABLE packages ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency IN ('USD', 'SGD', 'CNY', 'JPY'));
