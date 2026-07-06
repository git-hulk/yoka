//! Pure-function domain layer. No DB, no async, no HTTP — fully unit-testable.
//!
//! Anything in here can be re-used from a future CLI, batch job, or alternate
//! transport without dragging in tokio or sqlx.

pub mod ledger;
pub mod lifecycle;
pub mod recurrence;
