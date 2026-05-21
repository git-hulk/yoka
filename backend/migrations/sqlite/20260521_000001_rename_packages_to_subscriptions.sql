-- 20260521_000001_rename_packages_to_subscriptions.sql
--
-- Domain-level rename: `packages` → `subscriptions`. The HTTP/API surface,
-- Rust types, and frontend all moved to the new name; this migration brings
-- the SQL schema in line for existing databases.
--
-- SQLite ≥3.25 auto-updates FK references when a referenced table is renamed
-- and FK column references when a column is renamed, so we don't need to
-- drop-and-recreate the `usages` FK by hand. Indexes that *contain* the
-- renamed column keep working, but their *names* are not auto-updated — so
-- we drop and recreate them so identifiers stay consistent with their
-- targets.

ALTER TABLE packages RENAME TO subscriptions;
ALTER TABLE usages   RENAME COLUMN package_id TO subscription_id;

DROP INDEX IF EXISTS idx_packages_archived_at;
CREATE INDEX IF NOT EXISTS idx_subscriptions_archived_at
    ON subscriptions(archived_at);

DROP INDEX IF EXISTS idx_usages_package_id_created_at;
CREATE INDEX IF NOT EXISTS idx_usages_subscription_id_created_at
    ON usages(subscription_id, created_at);
