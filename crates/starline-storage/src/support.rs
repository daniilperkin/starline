use std::path::Path;

use crate::error::Result;
use crate::Store;

#[derive(Debug, Clone, Copy)]
pub struct OpenInfo {
    pub schema_version: i64,
    pub application_id: i64,
    pub revision: i64,
    pub locked_by_other: bool,
}

#[derive(Debug, Clone)]
pub struct SnapshotOut {
    pub path: String,
    pub byte_size: u64,
    pub created_at: i64,
}

impl Store {
    /// Consistent online snapshot via `VACUUM INTO` (spec §2.3.2). Fails if `dest` exists.
    pub fn snapshot(&mut self, dest: &Path) -> Result<SnapshotOut> {
        self.touch();
        self.conn
            .execute("VACUUM INTO ?1", [dest.to_string_lossy().to_string()])?;
        let meta = std::fs::metadata(dest)?;
        Ok(SnapshotOut {
            path: dest.display().to_string(),
            byte_size: meta.len(),
            created_at: now_ms(),
        })
    }

    /// `PRAGMA integrity_check`; `ok` iff the only message is "ok".
    pub fn integrity_check(&mut self) -> Result<(bool, Vec<String>)> {
        let mut stmt = self.conn.prepare("PRAGMA integrity_check")?;
        let mut rows = stmt.query([])?;
        let mut messages = Vec::new();
        while let Some(row) = rows.next()? {
            messages.push(row.get::<_, String>(0)?);
        }
        let ok = messages.len() == 1 && messages[0] == "ok";
        Ok((ok, messages))
    }

    /// File mtime in epoch milliseconds — the external-change poll (spec §5.4.1).
    pub fn mtime_ms(&self) -> Result<i64> {
        let modified = std::fs::metadata(&self.path)?.modified()?;
        let d = modified
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        Ok(d.as_millis() as i64)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
