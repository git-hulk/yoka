-- 20260520_000001_start_date.sql
--
-- Adds a `start_date` to packages so the lifecycle status (active /
-- not_start / done / expired) has a left edge. Before this column,
-- packages were implicitly active from creation; existing rows preserve
-- that by backfilling from `created_at`'s date part.
--
-- ALTER TABLE ADD COLUMN on a STRICT table requires a constant DEFAULT
-- when the column is NOT NULL. The two-step (add with sentinel, then
-- UPDATE from created_at) is the standard SQLite workaround for a
-- computed backfill.

ALTER TABLE packages ADD COLUMN start_date TEXT NOT NULL DEFAULT '1970-01-01';
UPDATE packages SET start_date = substr(created_at, 1, 10);
