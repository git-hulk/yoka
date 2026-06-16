//! Storage abstraction.
//!
//! `SubscriptionRepo` and `EventRepo` are the seam between HTTP handlers and the
//! concrete storage engine. Handlers hold `Arc<dyn …>`, so the underlying
//! backend (SQLite today, Postgres later) is interchangeable behind the same
//! method shapes.
//!
//! Row and write types live here too, so the trait surface is self-contained:
//! a new backend pulls in this one module and implements the two traits.

use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;

use crate::domain::ledger::Cadence;
use crate::domain::lifecycle::{TrackingMode, UsageInput};
use crate::domain::recurrence::RecurrenceRule;
use crate::error::AppError;

/// Row as stored. Returned by repo reads; handlers convert to the wire type
/// after combining with derived pace values. `categories` is stored as a
/// JSON array regardless of backend, so a sqlx `Json` wrapper works for both
/// SQLite (TEXT) and Postgres (JSONB).
#[derive(Debug, sqlx::FromRow)]
pub struct SubscriptionRow {
    pub id: String,
    pub name: String,
    pub quantity: Option<f64>,
    pub tracking_mode: TrackingMode,
    pub start_date: NaiveDate,
    pub expires_at: NaiveDate,
    pub notes: Option<String>,
    pub categories: Json<Vec<String>>,
    pub price_cents: Option<i64>,
    pub currency: String,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Fields a caller may set on insert/update. Mirrors the wire input, but
/// kept here so the db layer doesn't depend on `schema::`.
pub struct SubscriptionWrite<'a> {
    pub name: &'a str,
    pub quantity: Option<f64>,
    pub tracking_mode: TrackingMode,
    pub start_date: NaiveDate,
    pub expires_at: NaiveDate,
    pub notes: Option<&'a str>,
    /// Trimmed, deduped, capped (≤3). Owned because the handler builds it
    /// from a `Vec<String>` after normalization.
    pub categories: Vec<String>,
    pub price_cents: i64,
    pub currency: &'a str,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Status lifecycle for a calendar event. Only `Accepted` events that also
/// carry a `subscription_id` count toward pace calculations — see
/// `EventRepo::amounts_for_pace`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(rename_all = "lowercase")]
#[sqlx(type_name = "TEXT")]
pub enum EventStatus {
    Pending,
    Accepted,
    Declined,
}

#[derive(Debug, sqlx::FromRow)]
pub struct EventRow {
    pub id: String,
    pub title: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub status: EventStatus,
    pub subscription_id: Option<String>,
    pub amount: Option<f64>,
    pub notes: Option<String>,
    /// JSON-encoded `RecurrenceRule`. NULL when the event is a single
    /// occurrence. When set, the row is a "series root" and represents the
    /// template for the recurring instances.
    pub recurrence_rule: Option<Json<RecurrenceRule>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// `EventRow` plus the linked subscription's name + tracking_mode (when
/// linked). Returned from the calendar's range query so the frontend can
/// render chips without an N+1 lookup.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct EventWithSubscriptionRow {
    pub id: String,
    pub title: Option<String>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub status: EventStatus,
    pub subscription_id: Option<String>,
    pub subscription_name: Option<String>,
    pub tracking_mode: Option<TrackingMode>,
    pub amount: Option<f64>,
    pub notes: Option<String>,
    pub recurrence_rule: Option<Json<RecurrenceRule>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Fields a caller may set on event insert/update.
///
/// `(subscription_id, amount)` must agree: both `Some` or both `None`. The
/// HTTP layer validates this before calling the repo so the DB CHECK
/// constraint never fires as a fallback.
pub struct EventWrite<'a> {
    pub title: Option<&'a str>,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub status: EventStatus,
    pub subscription_id: Option<&'a str>,
    pub amount: Option<f64>,
    pub notes: Option<&'a str>,
    pub recurrence_rule: Option<RecurrenceRule>,
}

/// Per-instance override for one occurrence of a recurring series. The
/// presence of a row in `event_exceptions` overrides the series root's status
/// for that specific UTC date.
#[derive(Debug, sqlx::FromRow)]
pub struct EventExceptionRow {
    pub id: String,
    pub parent_id: String,
    pub instance_date: NaiveDate,
    pub status: EventStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------

/// Subscription aggregate. Every method is scoped by `group_id` — handlers
/// pass the caller's active group from `CurrentMember`, and the repo applies
/// it to WHERE / INSERT clauses so a leaked or stale id from one group can't
/// touch another.
#[async_trait]
pub trait SubscriptionRepo: Send + Sync + 'static {
    async fn fetch(&self, group_id: &str, id: &str) -> Result<SubscriptionRow, AppError>;
    async fn exists(&self, group_id: &str, id: &str) -> Result<bool, AppError>;
    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError>;
    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: SubscriptionWrite<'_>,
    ) -> Result<SubscriptionRow, AppError>;
    /// Hard-delete: removes child events then the subscription, in a transaction.
    /// Backends own the transaction so callers don't see a split surface.
    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError>;
    /// Soft-delete: stamp `archived_at`. Idempotent on already-archived rows
    /// only at the SQL level — backends return `NotFound` if no row matched,
    /// which the UI treats as "nothing to do".
    async fn archive(&self, group_id: &str, id: &str) -> Result<(), AppError>;
    /// Paginated active list. Returns the slice plus the *unpaginated* total
    /// so the HTTP layer can shape a page envelope without a follow-up count.
    async fn list_active(
        &self,
        group_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<SubscriptionRow>, i64), AppError>;
    /// Every subscription whose `start_date` falls in the inclusive range,
    /// including archived ones. Feeds the finance ledger projection — once a
    /// subscription has been paid for, the cost is real regardless of whether
    /// it's later archived; only hard-deleted rows (gone from the table) are
    /// excluded.
    async fn list_in_range(
        &self,
        group_id: &str,
        first_day: NaiveDate,
        last_day: NaiveDate,
    ) -> Result<Vec<SubscriptionRow>, AppError>;
    async fn list_categories(&self, group_id: &str) -> Result<Vec<String>, AppError>;
}

/// Event aggregate. Replaces the old `UsageRepo` — events generalize usages
/// (they can stand alone with no subscription link, and they carry a
/// pending/accepted/declined lifecycle). Group-scoped — see `SubscriptionRepo`.
#[async_trait]
pub trait EventRepo: Send + Sync + 'static {
    /// Does the given subscription have *any* event linked to it, regardless
    /// of status? Used to lock `tracking_mode` on the subscription PATCH.
    async fn any_for_subscription(
        &self,
        group_id: &str,
        subscription_id: &str,
    ) -> Result<bool, AppError>;

    /// Pace inputs for one subscription: only `accepted` events with a
    /// non-null `amount` count.
    async fn amounts_for_pace(
        &self,
        group_id: &str,
        subscription_id: &str,
    ) -> Result<Vec<UsageInput>, AppError>;

    /// Batched pace inputs for many subscriptions. Single query — avoids N+1
    /// on the home list.
    async fn amounts_for_pace_many(
        &self,
        group_id: &str,
        subscription_ids: &[String],
    ) -> Result<HashMap<String, Vec<UsageInput>>, AppError>;

    /// Every event linked to a subscription, newest-first. Status-agnostic —
    /// the detail page renders pending/accepted/declined alike.
    async fn list_for_subscription(
        &self,
        group_id: &str,
        subscription_id: &str,
    ) -> Result<Vec<EventRow>, AppError>;

    /// Cross-subscription range query for the calendar. Half-open
    /// `[from, to)`. Includes archived subscriptions' events so historical
    /// days still render. Includes standalone events (subscription_id NULL).
    async fn list_in_range(
        &self,
        group_id: &str,
        from: DateTime<Utc>,
        to: DateTime<Utc>,
    ) -> Result<Vec<EventWithSubscriptionRow>, AppError>;

    async fn fetch(&self, group_id: &str, id: &str) -> Result<EventRow, AppError>;
    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: EventWrite<'_>,
    ) -> Result<EventRow, AppError>;
    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: EventWrite<'_>,
    ) -> Result<EventRow, AppError>;

    /// Quick status mutation for the accept/decline buttons. Returns the
    /// updated row so the caller doesn't need a follow-up fetch.
    async fn set_status(
        &self,
        group_id: &str,
        id: &str,
        status: EventStatus,
    ) -> Result<EventRow, AppError>;

    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError>;

    // -- Recurrence -----------------------------------------------------------

    /// Upsert a per-instance status override. The pair `(parent_id,
    /// instance_date)` uniquely identifies one virtual instance.
    async fn upsert_exception(
        &self,
        group_id: &str,
        parent_id: &str,
        instance_date: NaiveDate,
        status: EventStatus,
    ) -> Result<EventExceptionRow, AppError>;

    /// Look up a single exception by parent + date. Returns `None` if no
    /// override exists (the instance inherits the series root's status).
    async fn fetch_exception(
        &self,
        group_id: &str,
        parent_id: &str,
        instance_date: NaiveDate,
    ) -> Result<Option<EventExceptionRow>, AppError>;

    /// All exceptions for a set of series roots. Used by the calendar's range
    /// query to overlay status onto virtual instances without N+1 lookups.
    async fn list_exceptions_for_parents(
        &self,
        group_id: &str,
        parent_ids: &[String],
    ) -> Result<Vec<EventExceptionRow>, AppError>;
}

// ---------------------------------------------------------------------------
// Finance: expenses, recurring expenses, budgets
// ---------------------------------------------------------------------------

/// Stored row for a one-off expense.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ExpenseRow {
    pub id: String,
    pub occurred_on: NaiveDate,
    pub amount_cents: i64,
    pub currency: String,
    pub category: String,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct ExpenseWrite<'a> {
    pub occurred_on: NaiveDate,
    pub amount_cents: i64,
    pub currency: &'a str,
    pub category: &'a str,
    pub notes: Option<&'a str>,
}

/// Stored row for a recurring-expense rule. Instances are derived on read.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct RecurringExpenseRow {
    pub id: String,
    pub name: String,
    pub amount_cents: i64,
    pub currency: String,
    pub category: String,
    pub cadence: Cadence,
    pub start_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct RecurringExpenseWrite<'a> {
    pub name: &'a str,
    pub amount_cents: i64,
    pub currency: &'a str,
    pub category: &'a str,
    pub cadence: Cadence,
    pub start_date: NaiveDate,
    pub end_date: Option<NaiveDate>,
    pub notes: Option<&'a str>,
}

/// Stored row for a monthly budget. UNIQUE (month, category, currency).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct BudgetRow {
    pub id: String,
    pub month: String,
    pub category: String,
    pub currency: String,
    pub amount_cents: i64,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct BudgetWrite<'a> {
    pub month: &'a str,
    pub category: &'a str,
    pub currency: &'a str,
    pub amount_cents: i64,
    pub notes: Option<&'a str>,
}

#[async_trait]
pub trait ExpenseRepo: Send + Sync + 'static {
    async fn fetch(&self, group_id: &str, id: &str) -> Result<ExpenseRow, AppError>;
    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: ExpenseWrite<'_>,
    ) -> Result<ExpenseRow, AppError>;
    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: ExpenseWrite<'_>,
    ) -> Result<ExpenseRow, AppError>;
    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError>;
    async fn list_paginated(
        &self,
        group_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<ExpenseRow>, i64), AppError>;
    /// Every expense whose `occurred_on` falls in the inclusive month window.
    /// Used by the ledger projection; the manage page uses `list_paginated`.
    async fn list_in_month(
        &self,
        group_id: &str,
        first_day: NaiveDate,
        last_day: NaiveDate,
    ) -> Result<Vec<ExpenseRow>, AppError>;
}

#[async_trait]
pub trait RecurringExpenseRepo: Send + Sync + 'static {
    async fn fetch(&self, group_id: &str, id: &str) -> Result<RecurringExpenseRow, AppError>;
    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: RecurringExpenseWrite<'_>,
    ) -> Result<RecurringExpenseRow, AppError>;
    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: RecurringExpenseWrite<'_>,
    ) -> Result<RecurringExpenseRow, AppError>;
    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError>;
    async fn archive(&self, group_id: &str, id: &str) -> Result<(), AppError>;
    async fn list_active(&self, group_id: &str) -> Result<Vec<RecurringExpenseRow>, AppError>;
    async fn list_all(&self, group_id: &str) -> Result<Vec<RecurringExpenseRow>, AppError>;
}

#[async_trait]
pub trait BudgetRepo: Send + Sync + 'static {
    async fn fetch(&self, group_id: &str, id: &str) -> Result<BudgetRow, AppError>;
    async fn insert(
        &self,
        group_id: &str,
        id: &str,
        input: BudgetWrite<'_>,
    ) -> Result<BudgetRow, AppError>;
    async fn update(
        &self,
        group_id: &str,
        id: &str,
        input: BudgetWrite<'_>,
    ) -> Result<BudgetRow, AppError>;
    async fn delete(&self, group_id: &str, id: &str) -> Result<(), AppError>;
    async fn list_for_month(
        &self,
        group_id: &str,
        month: &str,
    ) -> Result<Vec<BudgetRow>, AppError>;
    /// Every budget row whose `month` falls in the calendar year (i.e.
    /// month starts with `"YYYY-"`). Used by the yearly dashboard to
    /// aggregate the 12 monthly budgets per (category, currency).
    async fn list_for_year(&self, group_id: &str, year: &str)
        -> Result<Vec<BudgetRow>, AppError>;
}

// ---------------------------------------------------------------------------
// Users / Groups / Memberships / Invitations / Sessions
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserRow {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[async_trait]
pub trait UserRepo: Send + Sync + 'static {
    async fn create(
        &self,
        id: &str,
        email: &str,
        password_hash: &str,
    ) -> Result<UserRow, AppError>;
    async fn get_by_id(&self, id: &str) -> Result<UserRow, AppError>;
    async fn get_by_email(&self, email: &str) -> Result<Option<UserRow>, AppError>;
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GroupRow {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// One row in a group's member list — joined with the user's email so the
/// UI can render `email · role` without a follow-up lookup.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MemberRow {
    pub user_id: String,
    pub email: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

/// One row in a user's "groups I'm in" list. The role is the caller's role
/// in that group.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GroupForUserRow {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[async_trait]
pub trait GroupRepo: Send + Sync + 'static {
    async fn create(&self, id: &str, name: &str) -> Result<GroupRow, AppError>;
    async fn fetch(&self, id: &str) -> Result<GroupRow, AppError>;
    async fn rename(&self, id: &str, name: &str) -> Result<GroupRow, AppError>;
    async fn delete(&self, id: &str) -> Result<(), AppError>;

    async fn list_for_user(&self, user_id: &str) -> Result<Vec<GroupForUserRow>, AppError>;
    async fn list_members(&self, group_id: &str) -> Result<Vec<MemberRow>, AppError>;

    /// `(group_id, user_id)` is UNIQUE — `add_member` returns `Conflict` if a
    /// row already exists. The partial unique index on `(group_id) WHERE role
    /// = 'owner'` enforces single-owner.
    async fn add_member(
        &self,
        group_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), AppError>;
    async fn get_member_role(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> Result<Option<String>, AppError>;
    async fn update_member_role(
        &self,
        group_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), AppError>;
    async fn remove_member(&self, group_id: &str, user_id: &str) -> Result<(), AppError>;

    /// Atomic role swap: current owner → `admin`, `new_owner_user_id` → `owner`.
    /// Implemented as a transaction so the partial-unique-owner index never
    /// sees an intermediate two-owner state.
    async fn transfer_ownership(
        &self,
        group_id: &str,
        current_owner_id: &str,
        new_owner_id: &str,
    ) -> Result<(), AppError>;

    /// Number of distinct groups the user is a member of. Used to refuse
    /// removing oneself from one's only group.
    async fn count_memberships(&self, user_id: &str) -> Result<i64, AppError>;
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct InvitationRow {
    pub id: String,
    pub group_id: String,
    pub email: String,
    pub role: String,
    pub token: String,
    pub invited_by: String,
    pub expires_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

pub struct InvitationWrite<'a> {
    pub group_id: &'a str,
    pub email: &'a str,
    pub role: &'a str,
    pub token: &'a str,
    pub invited_by: &'a str,
    pub expires_at: DateTime<Utc>,
}

#[async_trait]
pub trait InvitationRepo: Send + Sync + 'static {
    async fn create(
        &self,
        id: &str,
        write: InvitationWrite<'_>,
    ) -> Result<InvitationRow, AppError>;
    async fn get_by_id(&self, id: &str) -> Result<Option<InvitationRow>, AppError>;
    async fn get_by_token(&self, token: &str) -> Result<Option<InvitationRow>, AppError>;
    async fn list_pending(&self, group_id: &str) -> Result<Vec<InvitationRow>, AppError>;
    async fn mark_accepted(&self, id: &str) -> Result<(), AppError>;
    async fn revoke(&self, id: &str) -> Result<(), AppError>;
}

/// Resolved (session, member) pair returned by `SessionRepo::get_with_member`.
/// Lives in the `db` layer so the trait can be implemented without depending
/// on the `auth` module; the middleware maps `role` (`String`) to the
/// strongly-typed `auth::Role` and rejects unknown values as `Internal`.
#[derive(Debug, Clone)]
pub struct SessionMember {
    pub user_id: String,
    pub group_id: String,
    pub role: String,
}

#[async_trait]
pub trait SessionRepo: Send + Sync + 'static {
    async fn create(
        &self,
        id: &str,
        user_id: &str,
        active_group_id: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<(), AppError>;
    async fn delete(&self, id: &str) -> Result<(), AppError>;
    /// Returns `None` if the session is missing OR expired OR the user is no
    /// longer a member of `active_group_id`. The middleware treats `None` as
    /// `Unauthorized`.
    async fn get_with_member(&self, id: &str) -> Result<Option<SessionMember>, AppError>;
    /// Updates `sessions.active_group_id`. Returns `NotFound` if the user
    /// isn't a member of `group_id` (so a stale id can't be used to peek).
    async fn set_active_group(
        &self,
        session_id: &str,
        user_id: &str,
        group_id: &str,
    ) -> Result<(), AppError>;
    async fn touch_expiry(&self, id: &str, expires_at: DateTime<Utc>) -> Result<(), AppError>;
    /// Deletes every session for a user (used on logout-all and on password
    /// rotation flows; called by `accept_invite` so prior cookies are dropped).
    async fn delete_for_user(&self, user_id: &str) -> Result<(), AppError>;
}
