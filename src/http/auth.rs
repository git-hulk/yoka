//! Auth endpoints: login, logout, accept-invite.
//!
//! All set the `yoka_session` cookie on success (cleared on logout). The cookie
//! is HttpOnly, SameSite=Lax, and `Secure` only when `YOKA_COOKIE_SECURE=1` is
//! set — local dev runs over plain HTTP where `Secure` would prevent the
//! browser from sending the cookie at all.

use axum::{extract::State, http::StatusCode, Json};
use axum_extra::extract::CookieJar;
use chrono::Utc;
use uuid::Uuid;

use crate::{
    auth::{password, session, CurrentMember, Role},
    db::InvitationWrite,
    error::AppError,
    http::AppState,
    schema::auth::{AcceptInviteInput, LoginInput, MeResponse, RegisterInput, UserResponse},
};

const MIN_PASSWORD_LEN: usize = 8;

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<LoginInput>,
) -> Result<(CookieJar, Json<MeResponse>), AppError> {
    let email = body.email.trim();
    if email.is_empty() || body.password.is_empty() {
        return Err(AppError::BadRequest("invalid_credentials"));
    }

    let user = state
        .users
        .get_by_email(email)
        .await?
        .ok_or(AppError::BadRequest("invalid_credentials"))?;

    if !password::verify(&body.password, &user.password_hash)? {
        return Err(AppError::BadRequest("invalid_credentials"));
    }

    let groups = state.groups.list_for_user(&user.id).await?;
    let active = groups
        .first()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "user has no group memberships"
        )))?
        .clone();

    let token = session::new_token();
    state
        .sessions
        .create(&token, &user.id, &active.id, session::default_expiry())
        .await?;

    let jar = jar.add(session::build_session_cookie(token, cookie_secure()));
    let me = build_me(&state, &user.id).await?;
    Ok((jar, Json(me)))
}

/// Open self-signup. Creates a user, a fresh "Personal" group with the user
/// as owner, and opens a session — the just-registered user lands logged in
/// without a separate login round-trip.
pub async fn register(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<RegisterInput>,
) -> Result<(CookieJar, Json<MeResponse>), AppError> {
    let email = body.email.trim();
    if email.is_empty() {
        return Err(AppError::BadRequest("email_required"));
    }
    if body.password.len() < MIN_PASSWORD_LEN {
        return Err(AppError::BadRequest("password_too_short"));
    }

    let hash = password::hash(&body.password)?;
    let user_id = Uuid::new_v4().to_string();
    // `users.create` already maps the UNIQUE-violation on email to
    // `Conflict("email_taken")`, so a duplicate signup gets a clean 409.
    state.users.create(&user_id, email, &hash).await?;

    let group_id = Uuid::new_v4().to_string();
    state.groups.create(&group_id, "Personal").await?;
    state
        .groups
        .add_member(&group_id, &user_id, Role::Owner.as_str())
        .await?;

    let token = session::new_token();
    state
        .sessions
        .create(&token, &user_id, &group_id, session::default_expiry())
        .await?;

    let jar = jar.add(session::build_session_cookie(token, cookie_secure()));
    let me = build_me(&state, &user_id).await?;
    Ok((jar, Json(me)))
}

pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AppError> {
    if let Some(c) = jar.get(session::COOKIE_NAME) {
        let _ = state.sessions.delete(c.value()).await;
    }
    let jar = jar.add(session::expire_session_cookie(cookie_secure()));
    Ok((jar, StatusCode::NO_CONTENT))
}

pub async fn accept_invite(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<AcceptInviteInput>,
) -> Result<(CookieJar, Json<MeResponse>), AppError> {
    if body.password.len() < MIN_PASSWORD_LEN {
        return Err(AppError::BadRequest("password_too_short"));
    }

    let invite = state
        .invitations
        .get_by_token(&body.token)
        .await?
        .ok_or(AppError::NotFound)?;

    if invite.accepted_at.is_some() {
        return Err(AppError::Conflict("invite_already_redeemed"));
    }
    if invite.revoked_at.is_some() {
        return Err(AppError::Conflict("invite_already_redeemed"));
    }
    if invite.expires_at < Utc::now() {
        return Err(AppError::Conflict("invite_expired"));
    }

    // If a user with this email already exists, this redemption path adds
    // them to the group; otherwise it creates the user. We require the
    // logged-out flow for the simpler v1 — an already-signed-in user clicking
    // the link just lands on this same endpoint without a session cookie.
    let role_str = invite.role.clone();
    let user_id = match state.users.get_by_email(&invite.email).await? {
        Some(existing) => existing.id,
        None => {
            let hash = password::hash(&body.password)?;
            let id = Uuid::new_v4().to_string();
            state.users.create(&id, &invite.email, &hash).await?;
            id
        }
    };

    // Add membership (idempotent-ish: if already present, surface conflict).
    state
        .groups
        .add_member(&invite.group_id, &user_id, &role_str)
        .await?;

    state.invitations.mark_accepted(&invite.id).await?;

    let token = session::new_token();
    state
        .sessions
        .create(&token, &user_id, &invite.group_id, session::default_expiry())
        .await?;

    let jar = jar.add(session::build_session_cookie(token, cookie_secure()));
    let me = build_me(&state, &user_id).await?;
    Ok((jar, Json(me)))
}

/// Shared by login / accept_invite responses and the `/me` endpoint.
pub async fn build_me(state: &AppState, user_id: &str) -> Result<MeResponse, AppError> {
    let user = state.users.get_by_id(user_id).await?;
    let groups = state.groups.list_for_user(user_id).await?;
    if groups.is_empty() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "user has no group memberships"
        )));
    }

    let summaries: Vec<crate::schema::auth::GroupSummary> = groups
        .into_iter()
        .map(|g| {
            let role = Role::parse_str(&g.role).unwrap_or(Role::Viewer);
            crate::schema::auth::GroupSummary {
                id: g.id,
                name: g.name,
                role,
            }
        })
        .collect();
    let active = summaries[0].clone();

    Ok(MeResponse {
        user: UserResponse {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
        },
        active_group: active.clone(),
        role: active.role,
        groups: summaries,
    })
}

/// Returns `MeResponse` shaped against the *session's* active group, not the
/// first membership. Used by `GET /me` for an authenticated caller.
pub async fn build_me_for_member(
    state: &AppState,
    me: &CurrentMember,
) -> Result<MeResponse, AppError> {
    let user = state.users.get_by_id(&me.user_id).await?;
    let groups = state.groups.list_for_user(&me.user_id).await?;

    let summaries: Vec<crate::schema::auth::GroupSummary> = groups
        .into_iter()
        .map(|g| crate::schema::auth::GroupSummary {
            role: Role::parse_str(&g.role).unwrap_or(Role::Viewer),
            id: g.id,
            name: g.name,
        })
        .collect();

    let active = summaries
        .iter()
        .find(|g| g.id == me.group_id)
        .cloned()
        .ok_or(AppError::Internal(anyhow::anyhow!(
            "active group missing from memberships"
        )))?;

    Ok(MeResponse {
        user: UserResponse {
            id: user.id,
            email: user.email,
            created_at: user.created_at,
        },
        active_group: active,
        role: me.role,
        groups: summaries,
    })
}

impl Clone for crate::schema::auth::GroupSummary {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            name: self.name.clone(),
            role: self.role,
        }
    }
}

/// Whether to set the `Secure` flag on issued cookies. Off by default so the
/// dev frontend on `http://localhost:5173` can keep its session.
fn cookie_secure() -> bool {
    std::env::var("YOKA_COOKIE_SECURE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

// Helper exposed so groups::create_invite can build the invitation URL prefix
// without duplicating the constant. Read from env at request time so the
// frontend's deploy URL doesn't have to live in code.
pub(super) fn invite_origin() -> String {
    std::env::var("YOKA_FRONTEND_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".to_string())
}

pub(super) async fn create_invitation_for_group(
    state: &AppState,
    me: &CurrentMember,
    email: String,
    role: Role,
) -> Result<crate::schema::groups::InviteResponse, AppError> {
    if role == Role::Owner {
        return Err(AppError::BadRequest("cannot_invite_owner"));
    }
    let email = email.trim().to_string();
    if email.is_empty() {
        return Err(AppError::BadRequest("email_required"));
    }

    let invite_id = Uuid::new_v4().to_string();
    let token = session::new_token();
    let expires_at = session::invite_expiry();
    let role_str = role.as_str().to_string();

    let row = state
        .invitations
        .create(
            &invite_id,
            InvitationWrite {
                group_id: &me.group_id,
                email: &email,
                role: &role_str,
                token: &token,
                invited_by: &me.user_id,
                expires_at,
            },
        )
        .await?;

    let invite_url = format!("{}/accept-invite/{}", invite_origin(), row.token);

    Ok(crate::schema::groups::InviteResponse {
        id: row.id,
        group_id: row.group_id,
        email: row.email,
        role: Role::parse_str(&row.role).unwrap_or(role),
        token: row.token,
        invite_url,
        expires_at: row.expires_at,
        accepted_at: row.accepted_at,
        revoked_at: row.revoked_at,
        created_at: row.created_at,
    })
}
