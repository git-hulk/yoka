//! Wire types — what crosses the HTTP boundary.
//!
//! Kept separate from db row structs so storage layout can evolve without
//! breaking the API, and from domain types so domain stays HTTP-agnostic.

pub mod auth;
pub mod events;
pub mod finance;
pub mod groups;
pub mod subscriptions;
pub mod timeline;
