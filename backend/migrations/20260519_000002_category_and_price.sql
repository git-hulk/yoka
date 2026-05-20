-- 20260519_000002_category_and_price.sql
--
-- Adds two optional descriptive columns surfaced by the detail view:
--   * category    — short tag like "Yoga" or "Coaching". Displayed in
--                   uppercase above the name; nullable for packages that
--                   don't fit a category.
--   * price_cents — purchase price stored as integer cents to avoid float
--                   rounding on a currency. Frontend formats. Nullable
--                   for free packages or unknowns.
--
-- ALTER TABLE ADD COLUMN is the only mutation SQLite supports here and the
-- only one we need — both columns are nullable, so there's no backfill.

ALTER TABLE packages ADD COLUMN category    TEXT;
ALTER TABLE packages ADD COLUMN price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0);
