//! Startup configuration.
//!
//! Sources, highest precedence first:
//!   1. Environment variables — `BIND_ADDR` (full host:port) and
//!      `DATABASE_URL` (full SQLite URL) override everything, so existing
//!      deployments keep working untouched.
//!   2. `config.yaml` — `port` and `data_dir`; the file is optional and its
//!      path can be moved with `YOKA_CONFIG`.
//!   3. Built-in defaults — 127.0.0.1:3000, `yoka.db` in the working
//!      directory.
//!
//! `deny_unknown_fields` turns config typos into boot errors instead of
//! silently ignored settings.

use std::io::ErrorKind;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::Deserialize;

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 3000;
pub const DB_FILE: &str = "yoka.db";

/// Shape of `config.yaml`. Every field optional — an empty (or absent) file
/// means "all defaults".
#[derive(Debug, Default, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileConfig {
    /// TCP port the server listens on. The host stays 127.0.0.1; use the
    /// `BIND_ADDR` env var to bind elsewhere.
    pub port: Option<u16>,
    /// Directory holding the SQLite database (`yoka.db`). Created at
    /// boot when missing.
    pub data_dir: Option<PathBuf>,
}

impl FileConfig {
    /// Read and parse the file; a missing file is not an error, a malformed
    /// or unknown-keyed one is.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => {
                return Err(e).with_context(|| format!("reading {}", path.display()))
            }
        };
        serde_yaml::from_str(&raw).with_context(|| format!("parsing {}", path.display()))
    }
}

/// Fully resolved runtime configuration.
#[derive(Debug, PartialEq)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub database_url: String,
    /// Set when the database location came from `data_dir` — the caller
    /// creates it before connecting (SQLite creates files, not directories).
    pub data_dir: Option<PathBuf>,
}

/// Merge the file config with the env overrides and defaults.
pub fn resolve(
    file: FileConfig,
    env_bind_addr: Option<String>,
    env_database_url: Option<String>,
) -> anyhow::Result<Config> {
    let bind_addr: SocketAddr = match env_bind_addr {
        Some(s) => s.parse().context("parsing BIND_ADDR")?,
        None => {
            let port = file.port.unwrap_or(DEFAULT_PORT);
            format!("{DEFAULT_HOST}:{port}")
                .parse()
                .expect("default host:port is a valid socket address")
        }
    };

    let (database_url, data_dir) = match env_database_url {
        Some(url) => (url, None),
        None => match file.data_dir {
            Some(dir) => (
                format!("sqlite://{}?mode=rwc", dir.join(DB_FILE).display()),
                Some(dir),
            ),
            None => (format!("sqlite://{DB_FILE}?mode=rwc"), None),
        },
    };

    Ok(Config {
        bind_addr,
        database_url,
        data_dir,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_no_file_and_no_env() {
        let cfg = resolve(FileConfig::default(), None, None).unwrap();
        assert_eq!(cfg.bind_addr, "127.0.0.1:3000".parse().unwrap());
        assert_eq!(cfg.database_url, "sqlite://yoka.db?mode=rwc");
        assert_eq!(cfg.data_dir, None);
    }

    #[test]
    fn file_sets_port_and_data_dir() {
        let file: FileConfig = serde_yaml::from_str("port: 8080\ndata_dir: /var/lib/yoka").unwrap();
        let cfg = resolve(file, None, None).unwrap();
        assert_eq!(cfg.bind_addr, "127.0.0.1:8080".parse().unwrap());
        assert_eq!(cfg.database_url, "sqlite:///var/lib/yoka/yoka.db?mode=rwc");
        assert_eq!(cfg.data_dir, Some(PathBuf::from("/var/lib/yoka")));
    }

    #[test]
    fn env_wins_over_file() {
        let file: FileConfig = serde_yaml::from_str("port: 8080\ndata_dir: data").unwrap();
        let cfg = resolve(
            file,
            Some("0.0.0.0:9999".to_string()),
            Some("sqlite://elsewhere.db?mode=rwc".to_string()),
        )
        .unwrap();
        assert_eq!(cfg.bind_addr, "0.0.0.0:9999".parse().unwrap());
        assert_eq!(cfg.database_url, "sqlite://elsewhere.db?mode=rwc");
        assert_eq!(cfg.data_dir, None); // env URL — nothing to create
    }

    #[test]
    fn empty_file_is_all_defaults() {
        let file: FileConfig = serde_yaml::from_str("").unwrap_or_default();
        assert_eq!(file, FileConfig::default());
    }

    #[test]
    fn unknown_keys_are_rejected() {
        let err = serde_yaml::from_str::<FileConfig>("prot: 8080");
        assert!(err.is_err());
    }
}
