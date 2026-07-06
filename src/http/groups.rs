//! Group + membership + invitation handlers.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use uuid::Uuid;

use crate::{
    auth::{CurrentMember, Role},
    error::AppError,
    http::AppState,
    schema::groups::{
        CreateGroupInput, CreateInviteInput, GroupResponse, InviteResponse, MemberResponse,
        RenameGroupInput, TransferOwnershipInput, UpdateMemberRoleInput,
    },
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

pub async fn create(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Json(body): Json<CreateGroupInput>,
) -> Result<(StatusCode, Json<GroupResponse>), AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name_required"));
    }
    let id = Uuid::new_v4().to_string();
    let group = state.groups.create(&id, name).await?;
    state
        .groups
        .add_member(&group.id, &me.user_id, Role::Owner.as_str())
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(GroupResponse {
            id: group.id,
            name: group.name,
            created_at: group.created_at,
            updated_at: group.updated_at,
        }),
    ))
}

pub async fn rename(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
    Json(body): Json<RenameGroupInput>,
) -> Result<Json<GroupResponse>, AppError> {
    // Only the owner of THIS group may rename it. The caller's `CurrentMember`
    // carries the active group; renaming a *different* group from this session
    // is intentionally not supported — switch to that group first.
    if id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Owner)?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name_required"));
    }
    let group = state.groups.rename(&id, name).await?;
    Ok(Json(GroupResponse {
        id: group.id,
        name: group.name,
        created_at: group.created_at,
        updated_at: group.updated_at,
    }))
}

pub async fn delete(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    if id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Owner)?;
    // Refuse to delete the user's last group — they'd be unable to log in
    // (no active group → middleware 401s).
    let count = state.groups.count_memberships(&me.user_id).await?;
    if count <= 1 {
        return Err(AppError::Conflict("last_group"));
    }
    state.groups.delete(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

pub async fn list_members(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(group_id): Path<String>,
) -> Result<Json<Vec<MemberResponse>>, AppError> {
    if group_id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Viewer)?;
    let rows = state.groups.list_members(&group_id).await?;
    Ok(Json(
        rows.into_iter()
            .map(|m| MemberResponse {
                user_id: m.user_id,
                email: m.email,
                role: Role::parse_str(&m.role).unwrap_or(Role::Viewer),
                created_at: m.created_at,
            })
            .collect(),
    ))
}

pub async fn update_member_role(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path((group_id, user_id)): Path<(String, String)>,
    Json(body): Json<UpdateMemberRoleInput>,
) -> Result<StatusCode, AppError> {
    if group_id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Admin)?;
    // Promoting *to* owner goes through `transfer-ownership`. The unique
    // partial index would also reject it; this gives a stable error code.
    if body.role == Role::Owner {
        return Err(AppError::BadRequest("use_transfer_ownership"));
    }
    // Admins can't demote the current owner via this endpoint either.
    let current = state
        .groups
        .get_member_role(&group_id, &user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if current == "owner" {
        return Err(AppError::Conflict("cannot_demote_owner"));
    }
    state
        .groups
        .update_member_role(&group_id, &user_id, body.role.as_str())
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_member(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path((group_id, user_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    if group_id != me.group_id {
        return Err(AppError::Forbidden);
    }
    // Admins can remove non-owners. Anyone can remove themselves (leave the
    // group) — except the owner, who has to transfer first.
    let is_self = me.user_id == user_id;
    if !is_self {
        me.require_role(Role::Admin)?;
    }

    let target_role = state
        .groups
        .get_member_role(&group_id, &user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if target_role == "owner" {
        return Err(AppError::Conflict("cannot_remove_owner"));
    }

    if is_self {
        let count = state.groups.count_memberships(&me.user_id).await?;
        if count <= 1 {
            return Err(AppError::Conflict("last_group"));
        }
    }

    state.groups.remove_member(&group_id, &user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn transfer_ownership(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(group_id): Path<String>,
    Json(body): Json<TransferOwnershipInput>,
) -> Result<StatusCode, AppError> {
    if group_id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Owner)?;
    if body.user_id == me.user_id {
        return Err(AppError::BadRequest("already_owner"));
    }
    state
        .groups
        .transfer_ownership(&group_id, &me.user_id, &body.user_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

pub async fn list_invitations(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(group_id): Path<String>,
) -> Result<Json<Vec<InviteResponse>>, AppError> {
    if group_id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Admin)?;
    let rows = state.invitations.list_pending(&group_id).await?;
    let origin = super::auth::invite_origin();
    Ok(Json(
        rows.into_iter()
            .map(|r| InviteResponse {
                invite_url: format!("{}/accept-invite/{}", origin, r.token),
                id: r.id,
                group_id: r.group_id,
                email: r.email,
                role: Role::parse_str(&r.role).unwrap_or(Role::Viewer),
                token: r.token,
                expires_at: r.expires_at,
                accepted_at: r.accepted_at,
                revoked_at: r.revoked_at,
                created_at: r.created_at,
            })
            .collect(),
    ))
}

pub async fn create_invitation(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path(group_id): Path<String>,
    Json(body): Json<CreateInviteInput>,
) -> Result<(StatusCode, Json<InviteResponse>), AppError> {
    if group_id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Admin)?;
    let resp =
        super::auth::create_invitation_for_group(&state, &me, body.email, body.role).await?;
    Ok((StatusCode::CREATED, Json(resp)))
}

pub async fn revoke_invitation(
    State(state): State<AppState>,
    Extension(me): Extension<CurrentMember>,
    Path((group_id, invite_id)): Path<(String, String)>,
) -> Result<StatusCode, AppError> {
    if group_id != me.group_id {
        return Err(AppError::Forbidden);
    }
    me.require_role(Role::Admin)?;
    let invite = state
        .invitations
        .get_by_id(&invite_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if invite.group_id != group_id {
        return Err(AppError::NotFound);
    }
    state.invitations.revoke(&invite_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
