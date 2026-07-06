//! Wire shapes for auth + identity endpoints.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::auth::Role;

#[derive(Debug, Deserialize)]
pub struct LoginInput {
    pub email:    String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterInput {
    pub email:    String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct AcceptInviteInput {
    pub token:    String,
    pub password: String,
}

/// Sent as the body of `GET /me`. Mirrors `frontend/src/lib/types.ts:Me`.
#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub user:         UserResponse,
    pub active_group: GroupSummary,
    pub role:         Role,
    pub groups:       Vec<GroupSummary>,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id:         String,
    pub email:      String,
    pub created_at: DateTime<Utc>,
}

/// A group as it appears in a user's group list — includes the user's role
/// in that group for the switcher UI.
#[derive(Debug, Serialize)]
pub struct GroupSummary {
    pub id:   String,
    pub name: String,
    pub role: Role,
}

#[derive(Debug, Deserialize)]
pub struct SetActiveGroupInput {
    pub group_id: String,
}
