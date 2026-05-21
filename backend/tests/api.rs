//! End-to-end tests against an in-memory SQLite.
//!
//! `sqlite::memory:` gives each connection its own database, so the pool is
//! pinned to `max_connections(1)` here to share a single in-memory DB across
//! every handler invocation in a test.

use std::str::FromStr;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use http_body_util::BodyExt;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tower::util::ServiceExt;

use yoka::http::{router, AppState};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async fn make_pool() -> SqlitePool {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")
        .unwrap()
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .unwrap()
}

/// Build an in-memory backend and return both the `AppState` for routing
/// and the raw `SqlitePool` for seed helpers that need to control
/// `created_at` (time-travel testing) — a capability the repo traits
/// deliberately don't expose.
async fn setup() -> (AppState, SqlitePool) {
    let pool = make_pool().await;
    yoka::db::sqlite::migrate(&pool).await.unwrap();
    let repos = yoka::db::sqlite::SqliteBackend { pool: pool.clone() }.into_repos();
    (AppState::from(repos), pool)
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

/// Insert a units/hours subscription directly via SQL. `quantity` is required;
/// for duration subscriptions use [`insert_duration_subscription`] instead.
async fn insert_subscription(pool: &SqlitePool, id: &str, quantity: f64, days_until: i64) {
    let expires_at = (Utc::now() + Duration::days(days_until)).date_naive();
    let start_date = Utc::now().date_naive();
    sqlx::query(
        r#"
        INSERT INTO subscriptions (id, name, quantity, tracking_mode, start_date, expires_at, currency)
        VALUES (?1, ?2, ?3, 'hours', ?4, ?5, 'USD')
        "#,
    )
    .bind(id)
    .bind(format!("sub-{id}"))
    .bind(quantity)
    .bind(start_date)
    .bind(expires_at)
    .execute(pool)
    .await
    .unwrap();
}

/// Insert a duration-mode subscription. `quantity` is NULL (CHECK enforces it).
async fn insert_duration_subscription(
    pool: &SqlitePool,
    id: &str,
    days_until_end: i64,
    days_since_start: i64,
) {
    let start_date = (Utc::now() - Duration::days(days_since_start)).date_naive();
    let expires_at = (Utc::now() + Duration::days(days_until_end)).date_naive();
    sqlx::query(
        r#"
        INSERT INTO subscriptions (id, name, tracking_mode, start_date, expires_at, currency)
        VALUES (?1, ?2, 'duration', ?3, ?4, 'USD')
        "#,
    )
    .bind(id)
    .bind(format!("sub-{id}"))
    .bind(start_date)
    .bind(expires_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_usage(
    pool: &SqlitePool,
    id: &str,
    subscription_id: &str,
    amount: f64,
    hours_ago: i64,
) {
    let ts = Utc::now() - Duration::hours(hours_ago);
    sqlx::query(
        r#"
        INSERT INTO usages (id, subscription_id, amount, created_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(id)
    .bind(subscription_id)
    .bind(amount)
    .bind(ts)
    .execute(pool)
    .await
    .unwrap();
}

/// Build a minimum-valid create-subscription JSON body. Override individual
/// fields via `mutate` before sending. Keeps tests compact and intention-
/// revealing.
fn subscription_body(mutate: impl FnOnce(&mut serde_json::Value)) -> serde_json::Value {
    let today = Utc::now().date_naive();
    let expires_at = (Utc::now() + Duration::days(30)).date_naive();
    let mut v = serde_json::json!({
        "name":          "test",
        "quantity":      10.0,
        "tracking_mode": "units",
        "start_date":    today.to_string(),
        "expires_at":    expires_at.to_string(),
        "notes":         null,
        "categories":    [],
        "price_cents":   18000,
        "currency":      "USD",
    });
    mutate(&mut v);
    v
}

async fn post_json(
    app: axum::Router,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn patch_json(
    app: axum::Router,
    path: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    app.oneshot(
        Request::builder()
            .method("PATCH")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await
    .unwrap()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_subscription_404_when_missing() {
    let app = router(setup().await.0);
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/subscriptions/nope")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "not_found");
}

#[tokio::test]
async fn get_subscription_returns_derived_pace_fields() {
    let (state, pool) = setup().await;
    // 14 units, 14 days until expiry, no usages, start_date today → Active,
    // required = 1.0/day.
    insert_subscription(&pool, "s1", 14.0, 14).await;

    let app = router(state);
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["id"], "s1");
    assert_eq!(body["quantity"], 14.0);
    assert_eq!(body["tracking_mode"], "hours");
    assert_eq!(body["consumed"], 0.0);
    assert_eq!(body["remaining"], 14.0);
    assert_eq!(body["status"], "active");
    assert_eq!(body["required_pace_per_day"], 1.0);
}

#[tokio::test]
async fn list_usages_returns_rows_newest_first_and_404s_unknown_subscription() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 20.0, 30).await;
    insert_usage(&pool, "u-old", "s1", 3.0, 3).await;
    insert_usage(&pool, "u-mid", "s1", 2.0, 2).await;
    insert_usage(&pool, "u-new", "s1", 1.0, 1).await;

    let app = router(state.clone());

    // Known subscription: 3 usages newest first.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/subscriptions/s1/usages")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr = body.as_array().expect("array");
    assert_eq!(arr.len(), 3);
    assert_eq!(arr[0]["id"], "u-new");
    assert_eq!(arr[1]["id"], "u-mid");
    assert_eq!(arr[2]["id"], "u-old");

    // Unknown subscription: 404, not [].
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/subscriptions/ghost/usages")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ---- duration mode --------------------------------------------------------

#[tokio::test]
async fn create_duration_subscription_with_null_quantity_succeeds() {
    let app = router(setup().await.0);
    let body = subscription_body(|v| {
        v["tracking_mode"] = serde_json::json!("duration");
        v["quantity"] = serde_json::Value::Null;
    });

    let resp = post_json(app, "/subscriptions", body).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = body_json(resp).await;
    assert_eq!(body["tracking_mode"], "duration");
    assert!(body["quantity"].is_null());
}

#[tokio::test]
async fn create_duration_subscription_with_quantity_rejected() {
    let app = router(setup().await.0);
    let body = subscription_body(|v| {
        v["tracking_mode"] = serde_json::json!("duration");
        v["quantity"] = serde_json::json!(5.0);
    });

    let resp = post_json(app, "/subscriptions", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "quantity_forbidden_for_duration");
}

#[tokio::test]
async fn create_units_subscription_without_quantity_rejected() {
    let app = router(setup().await.0);
    let body = subscription_body(|v| {
        v["tracking_mode"] = serde_json::json!("units");
        v["quantity"] = serde_json::Value::Null;
    });

    let resp = post_json(app, "/subscriptions", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "quantity_must_be_positive");
}

#[tokio::test]
async fn duration_subscription_mid_window_status_and_derivations() {
    let (state, pool) = setup().await;
    // 90-day window, 30 days in: consumed=30, remaining=60, no pace, active.
    insert_duration_subscription(&pool, "d1", 60, 30).await;

    let app = router(state);
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/subscriptions/d1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["tracking_mode"], "duration");
    assert!(body["quantity"].is_null());
    assert_eq!(body["consumed"], 30.0);
    assert_eq!(body["remaining"], 60.0);
    assert_eq!(body["status"], "active");
    assert!(body["required_pace_per_day"].is_null());
}

#[tokio::test]
async fn duration_subscription_after_window_is_done() {
    let (state, pool) = setup().await;
    // Window ended 5 days ago — no Expired in duration mode, only Done.
    insert_duration_subscription(&pool, "d2", -5, 95).await;

    let app = router(state);
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/subscriptions/d2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["status"], "done");
    assert_eq!(body["remaining"], 0.0);
}

#[tokio::test]
async fn create_usage_forbidden_on_duration_subscription() {
    let (state, pool) = setup().await;
    insert_duration_subscription(&pool, "d3", 30, 5).await;

    let app = router(state);
    let resp = post_json(
        app,
        "/subscriptions/d3/usages",
        serde_json::json!({ "amount": 1.0, "notes": null }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "usages_forbidden_for_duration");
}

#[tokio::test]
async fn patch_locks_tracking_mode_once_usages_exist() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;
    insert_usage(&pool, "u1", "s1", 1.0, 1).await;

    let app = router(state);
    // Try to flip hours → units while a usage exists.
    let body = subscription_body(|v| {
        v["tracking_mode"] = serde_json::json!("units");
        v["quantity"] = serde_json::json!(10.0);
    });
    let resp = patch_json(app, "/subscriptions/s1", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "tracking_mode_locked");
}
