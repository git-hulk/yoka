//! Authentication & authorization primitives.
//!
//! `Role` lives here because both the HTTP layer and the repo layer need to
//! reason about it. `CurrentMember` is what the auth middleware puts into the
//! axum request extensions for protected handlers to extract.

use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub mod middleware;
pub mod password;
pub mod session;

/// Membership role, ordered by privilege.
///
/// `Ord` makes "at least Editor" checks a `>=` comparison rather than a
/// match-every-variant. Serialized as lowercase strings to match the DB
/// CHECK constraint and the wire format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer,
    Editor,
    Admin,
    Owner,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Viewer => "viewer",
            Role::Editor => "editor",
            Role::Admin => "admin",
            Role::Owner => "owner",
        }
    }

    /// Parses a role string sourced from the DB. Returns `None` on an
    /// unrecognized value — the caller decides whether to treat that as an
    /// internal error. Named `parse_str` rather than `from_str` to avoid
    /// shadowing the `FromStr` trait method without actually implementing it.
    pub fn parse_str(s: &str) -> Option<Self> {
        match s {
            "viewer" => Some(Role::Viewer),
            "editor" => Some(Role::Editor),
            "admin" => Some(Role::Admin),
            "owner" => Some(Role::Owner),
            _ => None,
        }
    }
}

/// The authenticated caller plus their active group context. Built by
/// `middleware::require_auth` and pulled out of request extensions by every
/// protected handler.
#[derive(Debug, Clone)]
pub struct CurrentMember {
    pub user_id:  String,
    pub group_id: String,
    pub role:     Role,
}

impl CurrentMember {
    /// Returns `Forbidden` when the caller's role is below `needed`.
    /// Read endpoints typically call `require_role(Role::Viewer)`, mutations
    /// `require_role(Role::Editor)`, member admin `Role::Admin`, group admin
    /// `Role::Owner`.
    pub fn require_role(&self, needed: Role) -> Result<(), AppError> {
        if self.role >= needed {
            Ok(())
        } else {
            Err(AppError::Forbidden)
        }
    }
}
