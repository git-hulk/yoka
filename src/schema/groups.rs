//! Wire shapes for groups + members + invitations.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::auth::Role;

#[derive(Debug, Deserialize)]
pub struct CreateGroupInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct RenameGroupInput {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct GroupResponse {
    pub id:         String,
    pub name:       String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct MemberResponse {
    pub user_id:    String,
    pub email:      String,
    pub role:       Role,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleInput {
    /// Role to set. `owner` is rejected here — use the transfer endpoint.
    pub role: Role,
}

#[derive(Debug, Deserialize)]
pub struct TransferOwnershipInput {
    pub user_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateInviteInput {
    pub email: String,
    /// Owner-role invites are rejected — ownership is transferred, not invited.
    pub role:  Role,
}

#[derive(Debug, Serialize)]
pub struct InviteResponse {
    pub id:          String,
    pub group_id:    String,
    pub email:       String,
    pub role:        Role,
    pub token:       String,
    pub invite_url:  String,
    pub expires_at:  DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
    pub revoked_at:  Option<DateTime<Utc>>,
    pub created_at:  DateTime<Utc>,
}

/// Returned by the public `GET /invites/:token` endpoint so the accept-invite
/// page can render before the user has an account. Includes status so the
/// frontend can show "already used / revoked / expired" copy.
#[derive(Debug, Serialize)]
pub struct InvitePreviewResponse {
    pub group_name: String,
    pub email:      String,
    pub role:       Role,
    pub expires_at: DateTime<Utc>,
    pub status:     InviteStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InviteStatus {
    Pending,
    Accepted,
    Revoked,
    Expired,
}
