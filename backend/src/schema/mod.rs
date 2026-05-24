//! Wire types — what crosses the HTTP boundary.
//!
//! Kept separate from db row structs so storage layout can evolve without
//! breaking the API, and from domain types so domain stays HTTP-agnostic.

pub mod events;
pub mod finance;
pub mod subscriptions;
