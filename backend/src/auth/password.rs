//! Argon2id password hashing.
//!
//! `hash` returns a self-describing PHC string (algorithm + params + salt +
//! digest) which `verify` parses on its own — we don't store params separately.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

use crate::error::AppError;

/// Hash a plaintext password with a fresh random salt.
pub fn hash(plain: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let hasher = Argon2::default();
    hasher
        .hash_password(plain.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::Internal(anyhow::anyhow!("password hash failed: {e}")))
}

/// Verify a plaintext password against a stored hash. Returns `Ok(true)` on
/// a match, `Ok(false)` on a clean mismatch, and `Err` only when the stored
/// hash is malformed.
pub fn verify(plain: &str, stored_hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(stored_hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("malformed password hash: {e}")))?;
    Ok(Argon2::default()
        .verify_password(plain.as_bytes(), &parsed)
        .is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let h = hash("hunter2").unwrap();
        assert!(verify("hunter2", &h).unwrap());
        assert!(!verify("hunter3", &h).unwrap());
    }

    #[test]
    fn hashes_differ_across_calls() {
        // Salt randomization means even the same password yields a different
        // stored hash on every call.
        assert_ne!(hash("x").unwrap(), hash("x").unwrap());
    }
}
