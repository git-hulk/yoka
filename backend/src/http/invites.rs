//! Public `GET /invites/:token` — preview an invite before redeeming.
//!
//! Lives outside the auth perimeter so the accept-invite page can render
//! before the user has an account. Returns only the bits the page needs:
//! group name, role, email, expiry, and a coarse status (so we can show
//! "already used" / "expired" copy).

use axum::{extract::{Path, State}, Json};
use chrono::Utc;

use crate::{
    auth::Role,
    error::AppError,
    http::AppState,
    schema::groups::{InvitePreviewResponse, InviteStatus},
};

pub async fn show(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<InvitePreviewResponse>, AppError> {
    let invite = state
        .invitations
        .get_by_token(&token)
        .await?
        .ok_or(AppError::NotFound)?;
    let group = state.groups.fetch(&invite.group_id).await?;

    let status = if invite.accepted_at.is_some() {
        InviteStatus::Accepted
    } else if invite.revoked_at.is_some() {
        InviteStatus::Revoked
    } else if invite.expires_at < Utc::now() {
        InviteStatus::Expired
    } else {
        InviteStatus::Pending
    };

    Ok(Json(InvitePreviewResponse {
        group_name: group.name,
        email: invite.email,
        role: Role::parse_str(&invite.role).unwrap_or(Role::Viewer),
        expires_at: invite.expires_at,
        status,
    }))
}
