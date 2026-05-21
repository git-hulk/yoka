//! Database layer.
//!
//! Exposes the repository traits (`SubscriptionRepo`, `UsageRepo`) plus the
//! row/write types they trade in. The HTTP layer holds `Arc<dyn …>` so the
//! concrete backend is interchangeable. Each backend lives in its own
//! submodule (`sqlite`, future `postgres`) and writes idiomatic SQL for its
//! engine — no portable-SQL compromises.

use std::sync::Arc;

pub mod repo;
pub mod sqlite;

pub use repo::{SubscriptionRepo, SubscriptionRow, SubscriptionWrite, UsageRepo, UsageRow};

/// Bundle of repository handles shared by HTTP handlers via `AppState`.
///
/// `Arc<dyn …>` so the trait objects are cheap to clone per request. The
/// concrete impls hold their own pool (or other connection handle); cloning
/// the `Arc` doesn't touch the pool.
#[derive(Clone)]
pub struct Repos {
    pub subscriptions: Arc<dyn SubscriptionRepo>,
    pub usages: Arc<dyn UsageRepo>,
}
