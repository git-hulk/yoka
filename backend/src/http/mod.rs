//! HTTP layer. Owns the router; handlers live in submodules.
//!
//! Handlers are deliberately thin: extract args, call domain/db, shape the
//! response. Anything more interesting belongs in `domain::`.

use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::db::{
    BudgetRepo, EventRepo, ExpenseRepo, RecurringExpenseRepo, Repos, SubscriptionRepo,
};

pub mod events;
pub mod finance;
pub mod subscriptions;

/// Shared state passed to every handler.
///
/// Holds trait objects rather than a concrete pool so handlers don't know
/// (or care) which storage backend is running underneath. `Arc` clones are
/// cheap — handlers receive a fresh `AppState` per request.
#[derive(Clone)]
pub struct AppState {
    pub subscriptions: Arc<dyn SubscriptionRepo>,
    pub events: Arc<dyn EventRepo>,
    pub expenses: Arc<dyn ExpenseRepo>,
    pub recurring_expenses: Arc<dyn RecurringExpenseRepo>,
    pub budgets: Arc<dyn BudgetRepo>,
}

impl From<Repos> for AppState {
    fn from(repos: Repos) -> Self {
        Self {
            subscriptions: repos.subscriptions,
            events: repos.events,
            expenses: repos.expenses,
            recurring_expenses: repos.recurring_expenses,
            budgets: repos.budgets,
        }
    }
}

pub fn router(state: AppState) -> Router {
    // Permissive CORS in v1 — single-user, served on localhost alongside the
    // frontend dev server. Tighten before exposing externally.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/categories", get(subscriptions::list_categories))
        .route(
            "/subscriptions",
            get(subscriptions::list).post(subscriptions::create),
        )
        .route(
            "/subscriptions/:id",
            get(subscriptions::get_one)
                .patch(subscriptions::update)
                .delete(subscriptions::delete),
        )
        .route("/subscriptions/:id/archive", post(subscriptions::archive))
        .route(
            "/subscriptions/:id/events",
            get(events::list_for_subscription),
        )
        .route("/events", get(events::list_in_range).post(events::create))
        .route(
            "/events/:id",
            get(events::get_one)
                .patch(events::update)
                .delete(events::delete),
        )
        .route("/events/:id/accept", post(events::accept))
        .route("/events/:id/decline", post(events::decline))
        // Finance --------------------------------------------------------
        .route("/finance/ledger", get(finance::monthly_ledger))
        .route("/finance/yearly", get(finance::yearly_ledger))
        .route(
            "/finance/expenses",
            get(finance::list_expenses).post(finance::create_expense),
        )
        .route(
            "/finance/expenses/:id",
            get(finance::get_expense)
                .patch(finance::update_expense)
                .delete(finance::delete_expense),
        )
        .route(
            "/finance/recurring-expenses",
            get(finance::list_recurring).post(finance::create_recurring),
        )
        .route(
            "/finance/recurring-expenses/:id",
            get(finance::get_recurring)
                .patch(finance::update_recurring)
                .delete(finance::delete_recurring),
        )
        .route(
            "/finance/recurring-expenses/:id/archive",
            post(finance::archive_recurring),
        )
        .route(
            "/finance/budgets",
            get(finance::list_budgets).post(finance::create_budget),
        )
        .route(
            "/finance/budgets/:id",
            axum::routing::put(finance::update_budget).delete(finance::delete_budget),
        )
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
