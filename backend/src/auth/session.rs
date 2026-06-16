//! Session token generation and cookie helpers.
//!
//! Tokens are 32 random bytes encoded as URL-safe base64 (no padding) — opaque
//! to the client, stored verbatim as the `sessions.id` primary key. Cookie
//! settings (HttpOnly, SameSite=Lax, Path=/) match the standard "session
//! cookie that browsers don't forward across sites" defaults.

use axum_extra::extract::cookie::{Cookie, SameSite};
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;

/// Cookie name carrying the session token.
pub const COOKIE_NAME: &str = "yoka_session";

/// Session lifetime; refreshed (sliding) on every authenticated request.
pub const SESSION_TTL_DAYS: i64 = 30;

/// Invitation token lifetime.
pub const INVITE_TTL_DAYS: i64 = 7;

/// 32 random bytes → 43 base64url chars. Cryptographic-quality randomness
/// via the OS RNG.
pub fn new_token() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

/// Expiry stamp for a fresh session, formatted the same way `sessions.created_at`
/// is (ISO-8601 UTC).
pub fn default_expiry() -> DateTime<Utc> {
    Utc::now() + Duration::days(SESSION_TTL_DAYS)
}

/// Expiry stamp for a fresh invitation.
pub fn invite_expiry() -> DateTime<Utc> {
    Utc::now() + Duration::days(INVITE_TTL_DAYS)
}

/// Build the Set-Cookie value used by /auth/login and /auth/accept-invite.
///
/// `secure` should be `true` in production (HTTPS) and `false` for local
/// HTTP dev — browsers reject `Secure` cookies on `http://` even on
/// `localhost`. Wire it from a startup env flag (see `main.rs`).
pub fn build_session_cookie(token: String, secure: bool) -> Cookie<'static> {
    Cookie::build((COOKIE_NAME, token))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time::Duration::days(SESSION_TTL_DAYS))
        .build()
}

/// Build the Set-Cookie used by /auth/logout — same name + path so the
/// browser clears the original.
pub fn expire_session_cookie(secure: bool) -> Cookie<'static> {
    Cookie::build((COOKIE_NAME, ""))
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time::Duration::seconds(0))
        .build()
}
