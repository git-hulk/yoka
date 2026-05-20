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

async fn setup() -> AppState {
    let pool = make_pool().await;
    yoka::migrate(&pool).await.unwrap();
    AppState { pool }
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn insert_package(
    pool:       &SqlitePool,
    id:         &str,
    quantity:   f64,
    days_until: i64,
) {
    let expires_at = (Utc::now() + Duration::days(days_until)).date_naive();
    sqlx::query(
        r#"
        INSERT INTO packages (id, name, quantity, time_known, expires_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
    )
    .bind(id)
    .bind(format!("pkg-{id}"))
    .bind(quantity)
    .bind(true)
    .bind(expires_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_usage(
    pool:       &SqlitePool,
    id:         &str,
    package_id: &str,
    amount:     f64,
    hours_ago:  i64,
) {
    let ts = Utc::now() - Duration::hours(hours_ago);
    sqlx::query(
        r#"
        INSERT INTO usages (id, package_id, amount, created_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(id)
    .bind(package_id)
    .bind(amount)
    .bind(ts)
    .execute(pool)
    .await
    .unwrap();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_package_404_when_missing() {
    let app = router(setup().await);
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/packages/nope")
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
async fn get_package_returns_derived_pace_fields() {
    let state = setup().await;
    // 14 units, 14 days until expiry, no usages, start_date defaulted in the
    // past → Active, required = 1.0/day.
    insert_package(&state.pool, "p1", 14.0, 14).await;

    let app = router(state);
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/packages/p1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["id"],                    "p1");
    assert_eq!(body["quantity"],              14.0);
    assert_eq!(body["consumed"],              0.0);
    assert_eq!(body["remaining"],             14.0);
    assert_eq!(body["status"],                "active");
    assert_eq!(body["required_pace_per_day"], 1.0);
}

#[tokio::test]
async fn list_usages_returns_rows_newest_first_and_404s_unknown_package() {
    let state = setup().await;
    insert_package(&state.pool, "p1", 20.0, 30).await;
    insert_usage(&state.pool, "u-old", "p1", 3.0, 3).await;
    insert_usage(&state.pool, "u-mid", "p1", 2.0, 2).await;
    insert_usage(&state.pool, "u-new", "p1", 1.0, 1).await;

    let app = router(state.clone());

    // Known package: 3 usages newest first.
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/packages/p1/usages")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr  = body.as_array().expect("array");
    assert_eq!(arr.len(), 3);
    assert_eq!(arr[0]["id"], "u-new");
    assert_eq!(arr[1]["id"], "u-mid");
    assert_eq!(arr[2]["id"], "u-old");

    // Unknown package: 404, not [].
    let resp = app
        .oneshot(
            Request::builder()
                .uri("/packages/ghost/usages")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
