//! StarLine native storage: a thin rusqlite layer behind the StorageDriver contract.
//! One `Store` per project file; the Tauri shell and the headless CLI both drive it.

mod error;
mod json;
mod lock;
mod query;
mod support;

pub use error::{Error, Result};
pub use support::{OpenInfo, SnapshotOut};

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use lock::LockGuard;

/// `PRAGMA application_id` for `*.starline` files: "STRL" (spec §5.4.1).
pub const APPLICATION_ID: i64 = 0x5354_524C;
/// Files up to this size default to `synchronous=FULL` (DECISIONS.md #1, spec §5.3).
pub const SYNCHRONOUS_FULL_LIMIT_BYTES: u64 = 200 * 1024 * 1024;

pub struct Store {
    pub(crate) conn: Connection,
    pub(crate) path: PathBuf,
    pub(crate) read_only: bool,
    pub(crate) in_tx: bool,
    pub(crate) lock: Option<LockGuard>,
}

impl Store {
    /// Opens (and optionally creates) a project file. `create` only creates; it never truncates.
    pub fn open(path: &Path, create: bool, read_only: bool) -> Result<(Store, OpenInfo)> {
        let existed = path.exists();
        if !existed && !create {
            return Err(format!("file not found: {}", path.display()).into());
        }
        let mut flags = OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI;
        flags |= if read_only {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE
        };
        if create {
            flags |= OpenFlags::SQLITE_OPEN_CREATE;
        }
        let conn = Connection::open_with_flags(path, flags)?;
        conn.busy_timeout(std::time::Duration::from_millis(5000))?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        if !read_only {
            let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let sync_mode = if size <= SYNCHRONOUS_FULL_LIMIT_BYTES {
                "FULL"
            } else {
                "NORMAL"
            };
            conn.execute_batch(&format!(
                "PRAGMA journal_mode=WAL; PRAGMA synchronous={sync_mode};"
            ))?;
        }
        let application_id: i64 = conn.query_row("PRAGMA application_id", [], |r| r.get(0))?;
        let schema_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if application_id != 0 && application_id != APPLICATION_ID {
            return Err(
                format!("not a StarLine file (application_id = {application_id:#x})").into(),
            );
        }
        if application_id == 0 && !read_only && (!existed || schema_version == 0) {
            // Stamp fresh files immediately so even pre-migration databases are recognisable.
            conn.execute_batch(&format!("PRAGMA application_id = {APPLICATION_ID};"))?;
        }
        let revision = if table_exists(&conn, "meta")? {
            conn.query_row(
                "SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'revision'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0)
        } else {
            0
        };
        let (lock, locked_by_other) = if read_only {
            (None, false)
        } else {
            lock::acquire(path)?
        };
        let store = Store {
            conn,
            path: path.to_path_buf(),
            read_only,
            in_tx: false,
            lock,
        };
        let info = OpenInfo {
            schema_version,
            application_id: if application_id == 0 {
                APPLICATION_ID
            } else {
                application_id
            },
            revision,
            locked_by_other,
        };
        Ok((store, info))
    }

    /// Flushes WAL, releases the advisory lock.
    pub fn close(mut self) -> Result<()> {
        if self.in_tx {
            let _ = self.conn.execute_batch("ROLLBACK;");
            self.in_tx = false;
        }
        if !self.read_only {
            self.conn
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        }
        if let Some(guard) = self.lock.take() {
            lock::release(guard);
        }
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn is_read_only(&self) -> bool {
        self.read_only
    }

    pub(crate) fn touch(&self) {
        if let Some(guard) = &self.lock {
            lock::heartbeat(guard);
        }
    }
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}
