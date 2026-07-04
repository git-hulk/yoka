//! End-to-end tests against an in-memory SQLite.
//!
//! `sqlite::memory:` gives each connection its own database, so the pool is
//! pinned to `max_connections(1)` here to share a single in-memory DB across
//! every handler invocation in a test.
//!
//! Auth shim: every test boots with a fixed user/group/session via `setup()`,
//! and `req_builder()` attaches the matching `yoka_session` cookie so handlers
//! that live behind `require_auth` accept the request. SQL insert helpers
//! default to the test group's id so existing tests don't have to know group
//! ids exist.

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

const TEST_USER_ID:  &str = "test-user";
const TEST_GROUP_ID: &str = "test-group";
const TEST_TOKEN:    &str = "test-session-token";
const TEST_COOKIE:   &str = "yoka_session=test-session-token";

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

async fn setup() -> (AppState, SqlitePool) {
    let pool = make_pool().await;
    yoka::db::sqlite::migrate(&pool).await.unwrap();

    // Seed a single owner + group + open session with a known cookie token
    // so every test request authenticates as the test owner.
    sqlx::query(
        r#"INSERT INTO users (id, email, password_hash)
           VALUES (?1, 'test@example.com', '$argon2id$test')"#,
    )
    .bind(TEST_USER_ID)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO groups (id, name) VALUES (?1, 'Test Group')"#)
        .bind(TEST_GROUP_ID)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"INSERT INTO group_members (id, group_id, user_id, role)
           VALUES ('test-member', ?1, ?2, 'owner')"#,
    )
    .bind(TEST_GROUP_ID)
    .bind(TEST_USER_ID)
    .execute(&pool)
    .await
    .unwrap();
    let expires = Utc::now() + Duration::days(30);
    sqlx::query(
        r#"INSERT INTO sessions (id, user_id, active_group_id, expires_at)
           VALUES (?1, ?2, ?3, ?4)"#,
    )
    .bind(TEST_TOKEN)
    .bind(TEST_USER_ID)
    .bind(TEST_GROUP_ID)
    .bind(expires)
    .execute(&pool)
    .await
    .unwrap();

    let repos = yoka::db::sqlite::SqliteBackend { pool: pool.clone() }.into_repos();
    (AppState::from(repos), pool)
}

/// Request builder pre-loaded with the test session cookie. Drop-in
/// replacement for the raw axum `Request::builder()` so existing tests pick
/// up auth with no edits beyond a rename.
fn req_builder() -> axum::http::request::Builder {
    Request::builder().header("Cookie", TEST_COOKIE)
}

async fn body_json(resp: axum::response::Response) -> serde_json::Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn insert_subscription(pool: &SqlitePool, id: &str, quantity: f64, days_until: i64) {
    let expires_at = (Utc::now() + Duration::days(days_until)).date_naive();
    let start_date = Utc::now().date_naive();
    sqlx::query(
        r#"
        INSERT INTO subscriptions (id, name, quantity, tracking_mode, start_date, expires_at, currency, group_id)
        VALUES (?1, ?2, ?3, 'hours', ?4, ?5, 'USD', ?6)
        "#,
    )
    .bind(id)
    .bind(format!("sub-{id}"))
    .bind(quantity)
    .bind(start_date)
    .bind(expires_at)
    .bind(TEST_GROUP_ID)
    .execute(pool)
    .await
    .unwrap();
}

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
        INSERT INTO subscriptions (id, name, tracking_mode, start_date, expires_at, currency, group_id)
        VALUES (?1, ?2, 'duration', ?3, ?4, 'USD', ?5)
        "#,
    )
    .bind(id)
    .bind(format!("sub-{id}"))
    .bind(start_date)
    .bind(expires_at)
    .bind(TEST_GROUP_ID)
    .execute(pool)
    .await
    .unwrap();
}

/// Seed a subscription-linked, accepted event in the past. Mirrors the
/// pre-events `insert_usage` helper for tests that just want pace inputs.
async fn insert_accepted_event(
    pool: &SqlitePool,
    id: &str,
    subscription_id: &str,
    amount: f64,
    hours_ago: i64,
) {
    let ts = Utc::now() - Duration::hours(hours_ago);
    sqlx::query(
        r#"
        INSERT INTO events (id, start_at, status, subscription_id, amount, created_at, group_id)
        VALUES (?1, ?2, 'accepted', ?3, ?4, ?2, ?5)
        "#,
    )
    .bind(id)
    .bind(ts)
    .bind(subscription_id)
    .bind(amount)
    .bind(TEST_GROUP_ID)
    .execute(pool)
    .await
    .unwrap();
}

/// Build a minimum-valid create-subscription JSON body. Override individual
/// fields via `mutate` before sending.
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
        req_builder()
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
        req_builder()
            .method("PATCH")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
    .await
    .unwrap()
}

/// Render a UTC timestamp as `YYYY-MM-DDTHH:MM:SS.fffZ` — RFC 3339 but using
/// the `Z` shortcut so `+` doesn't need URL-encoding.
fn url_encode_dt(t: &chrono::DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

// ---------------------------------------------------------------------------
// Subscription read-side
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_subscription_404_when_missing() {
    let app = router(setup().await.0);
    let resp = app
        .oneshot(
            req_builder()
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
    insert_subscription(&pool, "s1", 14.0, 14).await;

    let app = router(state);
    let resp = app
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["id"], "s1");
    assert_eq!(body["consumed"], 0.0);
    assert_eq!(body["remaining"], 14.0);
    assert_eq!(body["status"], "active");
    assert_eq!(body["required_pace_per_day"], 1.0);
}

#[tokio::test]
async fn list_subscription_events_returns_newest_first_and_404s_unknown_subscription() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 20.0, 30).await;
    insert_accepted_event(&pool, "e-old", "s1", 3.0, 3).await;
    insert_accepted_event(&pool, "e-mid", "s1", 2.0, 2).await;
    insert_accepted_event(&pool, "e-new", "s1", 1.0, 1).await;

    let app = router(state);

    let resp = app
        .clone()
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1/events")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr = body.as_array().expect("array");
    assert_eq!(arr.len(), 3);
    assert_eq!(arr[0]["id"], "e-new");
    assert_eq!(arr[1]["id"], "e-mid");
    assert_eq!(arr[2]["id"], "e-old");

    let resp = app
        .oneshot(
            req_builder()
                .uri("/subscriptions/ghost/events")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// ---------------------------------------------------------------------------
// Duration mode
// ---------------------------------------------------------------------------

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
async fn duration_subscription_mid_window_status_and_derivations() {
    let (state, pool) = setup().await;
    insert_duration_subscription(&pool, "d1", 60, 30).await;

    let app = router(state);
    let resp = app
        .oneshot(
            req_builder()
                .uri("/subscriptions/d1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["status"], "active");
    assert_eq!(body["consumed"], 30.0);
    assert_eq!(body["remaining"], 60.0);
}

#[tokio::test]
async fn create_event_forbidden_on_duration_subscription() {
    let (state, pool) = setup().await;
    insert_duration_subscription(&pool, "d3", 30, 5).await;

    let app = router(state);
    let resp = post_json(
        app,
        "/events",
        serde_json::json!({
            "start_at":        Utc::now().to_rfc3339(),
            "subscription_id": "d3",
            "amount":          1.0,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "events_forbidden_for_duration");
}

// ---------------------------------------------------------------------------
// Events: status lifecycle drives pace
// ---------------------------------------------------------------------------

#[tokio::test]
async fn pending_event_does_not_count_toward_pace() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;

    // Default status (omitted) is pending — should not burn the package.
    let app = router(state);
    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "start_at":        (Utc::now() - Duration::hours(1)).to_rfc3339(),
            "subscription_id": "s1",
            "amount":          3.0,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    let resp = app
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["consumed"], 0.0);
    assert_eq!(body["remaining"], 10.0);
}

#[tokio::test]
async fn accepted_event_counts_toward_pace_and_decline_reverses_it() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;

    let app = router(state);
    // Create as accepted up front.
    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "start_at":        (Utc::now() - Duration::hours(1)).to_rfc3339(),
            "status":          "accepted",
            "subscription_id": "s1",
            "amount":          4.0,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let event_id = body_json(resp).await["id"].as_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["consumed"], 4.0);
    assert_eq!(body["remaining"], 6.0);

    // Decline removes the burn.
    let resp = post_json(
        app.clone(),
        &format!("/events/{event_id}/decline"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);

    let resp = app
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["consumed"], 0.0);
    assert_eq!(body["remaining"], 10.0);
}

#[tokio::test]
async fn accept_endpoint_flips_status_and_burns_subscription() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;

    let app = router(state);
    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "start_at":        (Utc::now() - Duration::hours(1)).to_rfc3339(),
            "subscription_id": "s1",
            "amount":          2.5,
        }),
    )
    .await;
    let event_id = body_json(resp).await["id"].as_str().unwrap().to_string();

    let resp = post_json(
        app.clone(),
        &format!("/events/{event_id}/accept"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["status"], "accepted");

    let resp = app
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["consumed"], 2.5);
}

#[tokio::test]
async fn accept_on_standalone_event_rejected() {
    let app = router(setup().await.0);
    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "title":    "lunch",
            "start_at": Utc::now().to_rfc3339(),
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let event_id = body_json(resp).await["id"].as_str().unwrap().to_string();

    let resp = post_json(
        app,
        &format!("/events/{event_id}/accept"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "accept_requires_subscription");
}

// ---------------------------------------------------------------------------
// Events: input validation
// ---------------------------------------------------------------------------

#[tokio::test]
async fn standalone_event_with_no_subscription_or_amount_succeeds() {
    let app = router(setup().await.0);
    let resp = post_json(
        app,
        "/events",
        serde_json::json!({
            "title":    "coffee",
            "start_at": Utc::now().to_rfc3339(),
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = body_json(resp).await;
    assert_eq!(body["title"], "coffee");
    assert!(body["subscription_id"].is_null());
    assert!(body["amount"].is_null());
    assert_eq!(body["status"], "pending");
}

#[tokio::test]
async fn event_with_subscription_but_no_amount_rejected() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;

    let app = router(state);
    let resp = post_json(
        app,
        "/events",
        serde_json::json!({
            "start_at":        Utc::now().to_rfc3339(),
            "subscription_id": "s1",
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "subscription_amount_mismatch");
}

#[tokio::test]
async fn event_with_amount_but_no_subscription_rejected() {
    let app = router(setup().await.0);
    let resp = post_json(
        app,
        "/events",
        serde_json::json!({
            "start_at": Utc::now().to_rfc3339(),
            "amount":   1.0,
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "subscription_amount_mismatch");
}

#[tokio::test]
async fn event_end_before_start_rejected() {
    let app = router(setup().await.0);
    let start = Utc::now();
    let resp = post_json(
        app,
        "/events",
        serde_json::json!({
            "title":    "weird",
            "start_at": start.to_rfc3339(),
            "end_at":   (start - Duration::hours(1)).to_rfc3339(),
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "end_before_start");
}

#[tokio::test]
async fn future_start_at_allowed() {
    let app = router(setup().await.0);
    let resp = post_json(
        app,
        "/events",
        serde_json::json!({
            "title":    "next week",
            "start_at": (Utc::now() + Duration::days(7)).to_rfc3339(),
        }),
    )
    .await;
    // Calendars schedule the future — this must not 400.
    assert_eq!(resp.status(), StatusCode::CREATED);
}

// ---------------------------------------------------------------------------
// Events: range query
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_events_in_range_filters_and_joins_subscription_metadata() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 20.0, 30).await;
    insert_subscription(&pool, "s2", 10.0, 30).await;

    insert_accepted_event(&pool, "e1", "s1", 1.0, 3).await;
    insert_accepted_event(&pool, "e2", "s2", 2.0, 2).await;
    insert_accepted_event(&pool, "e3", "s1", 3.0, 1).await;
    insert_accepted_event(&pool, "e4", "s1", 4.0, 0).await;

    // Range `[now - 90m, now + 1h)` catches e3 (-1h) and e4 (-0h).
    let from = Utc::now() - Duration::minutes(90);
    let to = Utc::now() + Duration::hours(1);
    let uri = format!(
        "/events?from={}&to={}",
        url_encode_dt(&from),
        url_encode_dt(&to)
    );

    let app = router(state);
    let resp = app
        .oneshot(req_builder().uri(&uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr = body.as_array().expect("array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["id"], "e3");
    assert_eq!(arr[0]["subscription_name"], "sub-s1");
    assert_eq!(arr[0]["tracking_mode"], "hours");
    assert_eq!(arr[1]["id"], "e4");
}

#[tokio::test]
async fn list_events_in_range_rejects_inverted_range() {
    let app = router(setup().await.0);
    let now = Utc::now();
    let earlier = now - Duration::days(1);
    let uri = format!(
        "/events?from={}&to={}",
        url_encode_dt(&now),
        url_encode_dt(&earlier)
    );
    let resp = app
        .oneshot(req_builder().uri(&uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "range_invalid");
}

#[tokio::test]
async fn list_events_in_range_includes_standalone_events() {
    let (state, _pool) = setup().await;
    let app = router(state);

    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "title":    "lunch",
            "start_at": Utc::now().to_rfc3339(),
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    let from = Utc::now() - Duration::hours(1);
    let to = Utc::now() + Duration::hours(1);
    let uri = format!(
        "/events?from={}&to={}",
        url_encode_dt(&from),
        url_encode_dt(&to)
    );
    let resp = app
        .oneshot(req_builder().uri(&uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr = body.as_array().expect("array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["title"], "lunch");
    assert!(arr[0]["subscription_id"].is_null());
}

// ---------------------------------------------------------------------------
// Events: PATCH
// ---------------------------------------------------------------------------

#[tokio::test]
async fn patch_event_can_move_start_at_and_change_amount() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;
    insert_accepted_event(&pool, "e1", "s1", 1.0, 1).await;

    let new_start = Utc::now() - Duration::days(7);
    let app = router(state);
    let resp = patch_json(
        app,
        "/events/e1",
        serde_json::json!({
            "start_at":        new_start.to_rfc3339(),
            "status":          "accepted",
            "subscription_id": "s1",
            "amount":          2.0,
            "notes":           "moved",
        }),
    )
    .await;

    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let stamped: chrono::DateTime<Utc> = body["start_at"].as_str().unwrap().parse().unwrap();
    let drift = (stamped - new_start).num_milliseconds().abs();
    assert!(drift < 1000);
    assert_eq!(body["amount"], 2.0);
    assert_eq!(body["notes"], "moved");
}

// ---------------------------------------------------------------------------
// tracking_mode lock — any event (regardless of status) locks the mode.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn patch_locks_tracking_mode_once_events_exist() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;
    insert_accepted_event(&pool, "e1", "s1", 1.0, 1).await;

    let app = router(state);
    let body = subscription_body(|v| {
        v["tracking_mode"] = serde_json::json!("units");
        v["quantity"] = serde_json::json!(10.0);
    });
    let resp = patch_json(app, "/subscriptions/s1", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "tracking_mode_locked");
}

// ---------------------------------------------------------------------------
// Recurring events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn recurring_event_expands_in_range_with_composite_ids() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 50.0, 60).await;
    let app = router(state);

    // Series: 5 daily instances starting 2 days ago at noon UTC.
    let start = Utc::now() - Duration::days(2);
    // The `+` in ISO 8601 timezone offset becomes space when URL-decoded; pin
    // to `Z` form by formatting via `format!` against `%Y-%m-%dT%H:%M:%SZ`.
    let from = (Utc::now() - Duration::days(7))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    let to = (Utc::now() + Duration::days(7))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();
    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "start_at":        start.to_rfc3339(),
            "subscription_id": "s1",
            "amount":          1.0,
            "recurrence_rule": { "freq": "daily", "count": 5 },
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let root_id = body_json(resp).await["id"].as_str().unwrap().to_string();

    let resp = app
        .oneshot(
            req_builder()
                .uri(format!("/events?from={from}&to={to}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    let arr = body.as_array().unwrap();
    assert_eq!(arr.len(), 5, "expected 5 expanded instances");
    // Every returned id should be composite (parent:date) except none should
    // match the bare root id (the root row itself isn't returned separately).
    for instance in arr {
        let id = instance["id"].as_str().unwrap();
        assert!(id.starts_with(&format!("{root_id}:")), "id was {id}");
        assert!(instance["recurrence_rule"].is_null());
    }
}

#[tokio::test]
async fn decline_instance_creates_exception_and_subtracts_from_pace() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 50.0, 60).await;
    let app = router(state);

    // 3 daily accepted instances starting 2 days ago. All burn at 2.0 each.
    let start = Utc::now() - Duration::days(2);
    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "start_at":        start.to_rfc3339(),
            "status":          "accepted",
            "subscription_id": "s1",
            "amount":          2.0,
            "recurrence_rule": { "freq": "daily", "count": 3 },
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let root_id = body_json(resp).await["id"].as_str().unwrap().to_string();

    // All 3 instances accepted by default -> consumed = 6.
    let resp = app
        .clone()
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["consumed"], 6.0);

    // Decline the first instance (the parent's own day).
    let first_date = start.date_naive();
    let composite = format!("{root_id}:{first_date}");
    let resp = post_json(
        app.clone(),
        &format!("/events/{composite}/decline"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;
    assert_eq!(body["status"], "declined");

    // Consumed drops by 2.
    let resp = app
        .oneshot(
            req_builder()
                .uri("/subscriptions/s1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["consumed"], 4.0);
}

#[tokio::test]
async fn per_instance_edit_and_delete_rejected() {
    let (state, pool) = setup().await;
    insert_subscription(&pool, "s1", 10.0, 30).await;
    let app = router(state);

    let start = Utc::now() - Duration::days(1);
    let resp = post_json(
        app.clone(),
        "/events",
        serde_json::json!({
            "start_at":        start.to_rfc3339(),
            "subscription_id": "s1",
            "amount":          1.0,
            "recurrence_rule": { "freq": "daily", "count": 3 },
        }),
    )
    .await;
    let root_id = body_json(resp).await["id"].as_str().unwrap().to_string();
    let composite = format!("{root_id}:{}", start.date_naive());

    // PATCH on a composite id is rejected.
    let req = req_builder()
        .method("PATCH")
        .uri(format!("/events/{composite}"))
        .header("content-type", "application/json")
        .body(Body::from(
            serde_json::json!({
                "start_at":        start.to_rfc3339(),
                "subscription_id": "s1",
                "amount":          5.0,
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "per_instance_edit_not_supported");

    // DELETE on a composite id is rejected.
    let req = req_builder()
        .method("DELETE")
        .uri(format!("/events/{composite}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "per_instance_delete_not_supported");
}

// ---------------------------------------------------------------------------
// Finance: ledger + expenses + recurring + budgets
// ---------------------------------------------------------------------------

/// Build a one-off expense body. Override individual fields via `mutate`.
fn expense_body(mutate: impl FnOnce(&mut serde_json::Value)) -> serde_json::Value {
    let mut v = serde_json::json!({
        "occurred_on":  "2026-05-10",
        "amount_cents": 1500,
        "currency":     "SGD",
        "category":     "Food",
        "notes":        "Lunch with team",
    });
    mutate(&mut v);
    v
}

fn recurring_body(mutate: impl FnOnce(&mut serde_json::Value)) -> serde_json::Value {
    let mut v = serde_json::json!({
        "name":         "Rent",
        "amount_cents": 250000,
        "currency":     "SGD",
        "category":     "Housing",
        "cadence":      "monthly",
        "start_date":   "2026-01-01",
        "end_date":     null,
        "notes":        null,
    });
    mutate(&mut v);
    v
}

fn budget_body(mutate: impl FnOnce(&mut serde_json::Value)) -> serde_json::Value {
    let mut v = serde_json::json!({
        "month":        "2026-05",
        "category":     "Food",
        "currency":     "SGD",
        "amount_cents": 60000,
        "notes":        null,
    });
    mutate(&mut v);
    v
}

#[tokio::test]
async fn create_expense_then_fetch_and_list() {
    let app = router(setup().await.0);

    let resp = post_json(app.clone(), "/finance/expenses", expense_body(|_| {})).await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body = body_json(resp).await;
    let id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["amount_cents"], 1500);
    assert_eq!(body["category"], "Food");

    // Fetch one.
    let resp = app
        .clone()
        .oneshot(
            req_builder()
                .uri(format!("/finance/expenses/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // List paginated.
    let resp = app
        .oneshot(
            req_builder()
                .uri("/finance/expenses")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    assert_eq!(body["total"], 1);
    assert_eq!(body["items"][0]["id"], id);
}

#[tokio::test]
async fn expense_amount_must_be_positive() {
    let app = router(setup().await.0);
    let body = expense_body(|v| v["amount_cents"] = serde_json::json!(0));
    let resp = post_json(app, "/finance/expenses", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "amount_must_be_positive");
}

#[tokio::test]
async fn expense_unsupported_currency_rejected() {
    let app = router(setup().await.0);
    let body = expense_body(|v| v["currency"] = serde_json::json!("EUR"));
    let resp = post_json(app, "/finance/expenses", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "currency_unsupported");
}

#[tokio::test]
async fn recurring_expense_end_before_start_rejected() {
    let app = router(setup().await.0);
    let body = recurring_body(|v| v["end_date"] = serde_json::json!("2025-12-01"));
    let resp = post_json(app, "/finance/recurring-expenses", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "end_date_before_start");
}

#[tokio::test]
async fn recurring_expense_archive_idempotent_via_notfound() {
    let app = router(setup().await.0);
    let resp = post_json(
        app.clone(),
        "/finance/recurring-expenses",
        recurring_body(|_| {}),
    )
    .await;
    let id = body_json(resp).await["id"].as_str().unwrap().to_string();

    let resp = post_json(
        app.clone(),
        &format!("/finance/recurring-expenses/{id}/archive"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Already archived → 404 (the "nothing to do" signal, same as subscriptions).
    let resp = post_json(
        app,
        &format!("/finance/recurring-expenses/{id}/archive"),
        serde_json::json!({}),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn budget_conflict_on_duplicate_key() {
    let app = router(setup().await.0);
    let resp = post_json(app.clone(), "/finance/budgets", budget_body(|_| {})).await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Same (month, category, currency) → conflict.
    let resp = post_json(app, "/finance/budgets", budget_body(|_| {})).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "budget_conflict");
}

#[tokio::test]
async fn budget_invalid_month_format_rejected() {
    let app = router(setup().await.0);
    let body = budget_body(|v| v["month"] = serde_json::json!("2026/05"));
    let resp = post_json(app, "/finance/budgets", body).await;
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "invalid_month_format");
}

#[tokio::test]
async fn ledger_includes_subscriptions_and_aggregates_into_bars() {
    let (state, pool) = setup().await;
    let app = router(state);

    // Seed two subscriptions purchased in the target month — one active,
    // one archived. Both should roll up into the same (category, currency)
    // bar: archiving doesn't undo a paid-for subscription's cost.
    sqlx::query(
        r#"
        INSERT INTO subscriptions (id, name, quantity, tracking_mode, start_date, expires_at,
                                   categories, price_cents, currency, archived_at, group_id)
        VALUES
          ('sub-A', 'Yoga 10x',    10.0, 'units', '2026-05-05', '2026-08-05',
           '["Wellness"]', 18000, 'USD', NULL, ?1),
          ('sub-B', 'Pilates 5x',   5.0, 'units', '2026-05-12', '2026-07-12',
           '["Wellness"]',  9000, 'USD', '2026-05-20T00:00:00.000Z', ?1)
        "#,
    )
    .bind(TEST_GROUP_ID)
    .execute(&pool)
    .await
    .unwrap();

    // One-off expense May 10, $45 USD Wellness.
    let resp = post_json(
        app.clone(),
        "/finance/expenses",
        expense_body(|v| {
            v["occurred_on"] = serde_json::json!("2026-05-10");
            v["amount_cents"] = serde_json::json!(4500);
            v["currency"] = serde_json::json!("USD");
            v["category"] = serde_json::json!("Wellness");
            v["notes"] = serde_json::Value::Null;
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Recurring rule: monthly, started January, $50 USD Wellness.
    let resp = post_json(
        app.clone(),
        "/finance/recurring-expenses",
        recurring_body(|v| {
            v["name"] = serde_json::json!("Gym");
            v["amount_cents"] = serde_json::json!(5000);
            v["currency"] = serde_json::json!("USD");
            v["category"] = serde_json::json!("Wellness");
            v["start_date"] = serde_json::json!("2026-01-15");
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Budget: $300 USD Wellness for May.
    let resp = post_json(
        app.clone(),
        "/finance/budgets",
        budget_body(|v| {
            v["month"] = serde_json::json!("2026-05");
            v["category"] = serde_json::json!("Wellness");
            v["currency"] = serde_json::json!("USD");
            v["amount_cents"] = serde_json::json!(30000);
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Fetch the ledger for May 2026.
    let resp = app
        .oneshot(
            req_builder()
                .uri("/finance/ledger?month=2026-05")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;

    // Four entries: two subscriptions (active + archived) + expense + recurring.
    let entries = body["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 4);
    let sub_count = entries
        .iter()
        .filter(|e| e["source"]["kind"] == "subscription")
        .count();
    assert_eq!(sub_count, 2);

    // Bars: one ("Wellness", "USD") with budget 30000 and
    // spent_cents = 18000 (active sub) + 9000 (archived sub) + 4500 (expense)
    //             + 5000 (recurring) = 36500.
    let bars = body["bars"].as_array().unwrap();
    assert_eq!(bars.len(), 1);
    assert_eq!(bars[0]["category"], "Wellness");
    assert_eq!(bars[0]["currency"], "USD");
    assert_eq!(bars[0]["budget_cents"], 30000);
    assert_eq!(bars[0]["spent_cents"], 36500);

    assert_eq!(body["currencies"], serde_json::json!(["USD"]));
}

#[tokio::test]
async fn ledger_bar_with_budget_and_no_spend_still_shown() {
    let app = router(setup().await.0);
    let resp = post_json(
        app.clone(),
        "/finance/budgets",
        budget_body(|v| {
            v["month"] = serde_json::json!("2026-05");
            v["category"] = serde_json::json!("Untouched");
            v["currency"] = serde_json::json!("SGD");
            v["amount_cents"] = serde_json::json!(10000);
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    let resp = app
        .oneshot(
            req_builder()
                .uri("/finance/ledger?month=2026-05")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    let bars = body["bars"].as_array().unwrap();
    assert_eq!(bars.len(), 1);
    assert_eq!(bars[0]["budget_cents"], 10000);
    assert_eq!(bars[0]["spent_cents"], 0);
}

#[tokio::test]
async fn ledger_bar_with_spend_and_no_budget_still_shown() {
    let app = router(setup().await.0);
    let resp = post_json(
        app.clone(),
        "/finance/expenses",
        expense_body(|v| {
            v["occurred_on"] = serde_json::json!("2026-05-12");
            v["amount_cents"] = serde_json::json!(2500);
            v["currency"] = serde_json::json!("SGD");
            v["category"] = serde_json::json!("Coffee");
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    let resp = app
        .oneshot(
            req_builder()
                .uri("/finance/ledger?month=2026-05")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    let bars = body["bars"].as_array().unwrap();
    assert_eq!(bars.len(), 1);
    assert!(bars[0]["budget_cents"].is_null());
    assert_eq!(bars[0]["spent_cents"], 2500);
}

#[tokio::test]
async fn yearly_dashboard_includes_subscriptions_recurring_and_expense() {
    let (state, pool) = setup().await;
    let app = router(state);

    // Seed a subscription that was purchased mid-year — its price rolls
    // into both the yearly category total and the May entry of the
    // monthly trend.
    sqlx::query(
        r#"
        INSERT INTO subscriptions (id, name, quantity, tracking_mode, start_date, expires_at,
                                   categories, price_cents, currency, group_id)
        VALUES ('sub-A', 'Yoga 10x', 10.0, 'units', '2026-05-05', '2026-08-05',
                '["Wellness"]', 18000, 'USD', ?1)
        "#,
    )
    .bind(TEST_GROUP_ID)
    .execute(&pool)
    .await
    .unwrap();

    // Two one-off expenses in different months but the same year.
    for occurred in ["2026-02-10", "2026-09-22"] {
        let resp = post_json(
            app.clone(),
            "/finance/expenses",
            expense_body(|v| {
                v["occurred_on"] = serde_json::json!(occurred);
                v["amount_cents"] = serde_json::json!(4500);
                v["currency"] = serde_json::json!("USD");
                v["category"] = serde_json::json!("Wellness");
                v["notes"] = serde_json::Value::Null;
            }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    // Monthly recurring rule: $50 every month, USD Wellness, all of 2026.
    let resp = post_json(
        app.clone(),
        "/finance/recurring-expenses",
        recurring_body(|v| {
            v["name"] = serde_json::json!("Gym");
            v["amount_cents"] = serde_json::json!(5000);
            v["currency"] = serde_json::json!("USD");
            v["category"] = serde_json::json!("Wellness");
            v["start_date"] = serde_json::json!("2026-01-01");
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Budgets for the same category across 3 of the 12 months.
    for (month, amount) in [("2026-01", 30000), ("2026-02", 30000), ("2026-12", 30000)] {
        let resp = post_json(
            app.clone(),
            "/finance/budgets",
            budget_body(|v| {
                v["month"] = serde_json::json!(month);
                v["category"] = serde_json::json!("Wellness");
                v["currency"] = serde_json::json!("USD");
                v["amount_cents"] = serde_json::json!(amount);
            }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    // Fetch the yearly dashboard.
    let resp = app
        .oneshot(
            req_builder()
                .uri("/finance/yearly?year=2026")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = body_json(resp).await;

    assert_eq!(body["year"], "2026");
    assert_eq!(body["currencies"], serde_json::json!(["USD"]));

    let bars = body["bars"].as_array().unwrap();
    assert_eq!(bars.len(), 1);
    let bar = &bars[0];
    assert_eq!(bar["category"], "Wellness");
    assert_eq!(bar["currency"], "USD");
    // Yearly budget = 30000 × 3 months = 90000.
    assert_eq!(bar["budget_cents"], 90000);
    // Yearly spend = subscription 18000 + 2 expenses 9000 + 12 × recurring 5000 = 87000.
    assert_eq!(bar["spent_cents"], 87000);

    // Monthly trend: dense 12 entries for USD. Recurring 5000/month is the
    // baseline; February adds expense (+4500); September adds the other
    // expense (+4500); May adds the subscription (+18000).
    let monthly = body["monthly_totals"].as_array().unwrap();
    let usd: Vec<&serde_json::Value> = monthly.iter().filter(|m| m["currency"] == "USD").collect();
    assert_eq!(usd.len(), 12);
    let by_month: std::collections::HashMap<u64, i64> = usd
        .iter()
        .map(|m| {
            (
                m["month"].as_u64().unwrap(),
                m["spent_cents"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(by_month[&1], 5000);
    assert_eq!(by_month[&2], 5000 + 4500);
    assert_eq!(by_month[&5], 5000 + 18000);
    assert_eq!(by_month[&9], 5000 + 4500);
    assert_eq!(by_month[&12], 5000);
}

#[tokio::test]
async fn yearly_invalid_year_format_rejected() {
    let app = router(setup().await.0);
    let resp = app
        .oneshot(
            req_builder()
                .uri("/finance/yearly?year=26")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "invalid_year_format");
}

#[tokio::test]
async fn ledger_groups_currencies_separately() {
    let app = router(setup().await.0);
    // Two expenses, different currencies, same category.
    let resp = post_json(
        app.clone(),
        "/finance/expenses",
        expense_body(|v| {
            v["occurred_on"] = serde_json::json!("2026-05-01");
            v["amount_cents"] = serde_json::json!(1000);
            v["currency"] = serde_json::json!("SGD");
            v["category"] = serde_json::json!("Food");
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let resp = post_json(
        app.clone(),
        "/finance/expenses",
        expense_body(|v| {
            v["occurred_on"] = serde_json::json!("2026-05-02");
            v["amount_cents"] = serde_json::json!(800);
            v["currency"] = serde_json::json!("USD");
            v["category"] = serde_json::json!("Food");
        }),
    )
    .await;
    assert_eq!(resp.status(), StatusCode::CREATED);

    let resp = app
        .oneshot(
            req_builder()
                .uri("/finance/ledger?month=2026-05")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let body = body_json(resp).await;
    // Two distinct currencies in the response.
    let currencies = body["currencies"].as_array().unwrap();
    let codes: Vec<String> = currencies
        .iter()
        .map(|c| c.as_str().unwrap().to_string())
        .collect();
    assert!(codes.contains(&"SGD".to_string()));
    assert!(codes.contains(&"USD".to_string()));
    assert_eq!(codes.len(), 2);
}

// ---------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------

#[tokio::test]
async fn timeline_event_crud_and_year_window() {
    let (state, _pool) = setup().await;

    // Create.
    let resp = router(state.clone())
        .oneshot(
            req_builder()
                .method("POST")
                .uri("/timeline-events")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "title": "  Moved apartments  ",
                        "occurred_on": "2026-03-15",
                        "notes": "  "
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let created = body_json(resp).await;
    assert_eq!(created["title"], "Moved apartments"); // trimmed
    assert!(created["notes"].is_null()); // blank collapses to null
    let id = created["id"].as_str().unwrap().to_string();

    // Listed inside its year, absent outside it.
    let resp = router(state.clone())
        .oneshot(
            req_builder()
                .uri("/timeline-events?year=2026")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let listed = body_json(resp).await;
    assert_eq!(listed.as_array().unwrap().len(), 1);
    let resp = router(state.clone())
        .oneshot(
            req_builder()
                .uri("/timeline-events?year=2025")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body_json(resp).await.as_array().unwrap().len(), 0);

    // Update.
    let resp = router(state.clone())
        .oneshot(
            req_builder()
                .method("PATCH")
                .uri(format!("/timeline-events/{id}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({
                        "title": "Moved to the new place",
                        "occurred_on": "2026-04-01",
                        "notes": "big milestone"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let updated = body_json(resp).await;
    assert_eq!(updated["occurred_on"], "2026-04-01");
    assert_eq!(updated["notes"], "big milestone");

    // Blank title rejected with the stable code.
    let resp = router(state.clone())
        .oneshot(
            req_builder()
                .method("POST")
                .uri("/timeline-events")
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({"title": "   ", "occurred_on": "2026-01-01"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(resp).await["error"], "title_required");

    // Delete, then the year window is empty again.
    let resp = router(state.clone())
        .oneshot(
            req_builder()
                .method("DELETE")
                .uri(format!("/timeline-events/{id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    let resp = router(state)
        .oneshot(
            req_builder()
                .uri("/timeline-events?year=2026")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(body_json(resp).await.as_array().unwrap().len(), 0);
}
