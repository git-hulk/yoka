//! HTTP layer. Owns the router; handlers live in submodules.
//!
//! Handlers are deliberately thin: extract args, call domain/db, shape the
//! response. Anything more interesting belongs in `domain::`.

use std::sync::Arc;

use axum::{
    http::{HeaderValue, Method},
    middleware,
    routing::{get, post},
    Router,
};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::db::{
    BudgetRepo, EventRepo, ExpenseRepo, GroupRepo, InvitationRepo, RecurringExpenseRepo, Repos,
    SessionRepo, SubscriptionRepo, UserRepo,
};

pub mod auth;
pub mod events;
pub mod finance;
pub mod groups;
pub mod invites;
pub mod me;
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
    pub users: Arc<dyn UserRepo>,
    pub groups: Arc<dyn GroupRepo>,
    pub invitations: Arc<dyn InvitationRepo>,
    pub sessions: Arc<dyn SessionRepo>,
}

impl From<Repos> for AppState {
    fn from(repos: Repos) -> Self {
        Self {
            subscriptions: repos.subscriptions,
            events: repos.events,
            expenses: repos.expenses,
            recurring_expenses: repos.recurring_expenses,
            budgets: repos.budgets,
            users: repos.users,
            groups: repos.groups,
            invitations: repos.invitations,
            sessions: repos.sessions,
        }
    }
}

pub fn router(state: AppState) -> Router {
    // CORS is credential-bearing now (the session cookie is HttpOnly and must
    // be sent on cross-origin requests from the dev frontend). `allow_origin`
    // can't be `Any` when credentials are allowed — browsers reject the
    // response — so we hardcode `http://localhost:5173` in dev and let prod
    // override via env.
    let frontend = std::env::var("YOKA_FRONTEND_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:5173".to_string());
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::exact(
            HeaderValue::from_str(&frontend).expect("YOKA_FRONTEND_ORIGIN must be a valid origin"),
        ))
        .allow_credentials(true)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
        ]);

    // Public routes — no auth required. Login + accept-invite issue cookies
    // themselves; the invite preview is unauthenticated so the page can render
    // before the user has an account.
    let public = Router::new()
        .route("/auth/login", post(auth::login))
        .route("/auth/register", post(auth::register))
        .route("/auth/accept-invite", post(auth::accept_invite))
        .route("/invites/:token", get(invites::show));

    // Protected routes — `require_auth` wraps everything below.
    let protected = Router::new()
        // Identity
        .route("/auth/logout", post(auth::logout))
        .route("/me", get(me::show))
        .route("/me/active-group", post(me::set_active_group))
        // Groups + members
        .route("/groups", post(groups::create))
        .route(
            "/groups/:id",
            axum::routing::patch(groups::rename).delete(groups::delete),
        )
        .route("/groups/:id/members", get(groups::list_members))
        .route(
            "/groups/:id/members/:user_id",
            axum::routing::patch(groups::update_member_role).delete(groups::remove_member),
        )
        .route(
            "/groups/:id/transfer-ownership",
            post(groups::transfer_ownership),
        )
        .route(
            "/groups/:id/invitations",
            get(groups::list_invitations).post(groups::create_invitation),
        )
        .route(
            "/groups/:id/invitations/:invite_id",
            axum::routing::delete(groups::revoke_invitation),
        )
        // Resources — existing
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
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            crate::auth::middleware::require_auth,
        ));

    Router::new()
        .merge(public)
        .merge(protected)
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
