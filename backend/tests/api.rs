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
        INSERT INTO events (id, start_at, status, subscription_id, amount, created_at)
        VALUES (?1, ?2, 'accepted', ?3, ?4, ?2)
        "#,
    )
    .bind(id)
    .bind(ts)
    .bind(subscription_id)
    .bind(amount)
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
            Request::builder()
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
            Request::builder()
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
            Request::builder()
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
            Request::builder()
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
            Request::builder()
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
            Request::builder()
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
            Request::builder()
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
        .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
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
        .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
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
        .oneshot(Request::builder().uri(&uri).body(Body::empty()).unwrap())
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
            Request::builder()
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
            Request::builder()
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
            Request::builder()
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
    let req = Request::builder()
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
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/events/{composite}"))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = body_json(resp).await;
    assert_eq!(body["error"], "per_instance_delete_not_supported");
}
