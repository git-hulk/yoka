//! `require_auth` axum middleware.
//!
//! Extracts the session cookie, looks up the session row, joins to
//! `group_members` to get the caller's role in their active group, and stashes
//! a [`CurrentMember`] in request extensions for handlers to pull out. Also
//! refreshes the session's `expires_at` on every authenticated hit (sliding
//! expiry) so active sessions don't suddenly log out mid-flow.

use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use axum_extra::extract::CookieJar;

use crate::auth::session::{default_expiry, COOKIE_NAME};
use crate::auth::{CurrentMember, Role};
use crate::error::AppError;
use crate::http::AppState;

pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = jar
        .get(COOKIE_NAME)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    let sm = state
        .sessions
        .get_with_member(&token)
        .await?
        .ok_or(AppError::Unauthorized)?;

    let role = Role::parse_str(&sm.role).ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!("unknown role in db: {}", sm.role))
    })?;
    let member = CurrentMember {
        user_id:  sm.user_id,
        group_id: sm.group_id,
        role,
    };

    // Sliding expiry — keep active users logged in. Best-effort: a failure
    // to update the row shouldn't block the request that already authenticated.
    if let Err(e) = state.sessions.touch_expiry(&token, default_expiry()).await {
        tracing::warn!(error = %e, "failed to touch session expiry");
    }

    req.extensions_mut().insert(member);
    Ok(next.run(req).await)
}
