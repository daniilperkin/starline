use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;

use crate::error::Result;

/// Advisory lock for a project file (spec §2.3.3): `<file>.lock` holding pid/host/heartbeat.
/// Stale after 60 s without heartbeat; `STARLINE_LOCK_STALE_MS` overrides that window (used by
/// the chaos harness so a killed process's lock is taken over immediately).
pub struct LockGuard {
    pub path: PathBuf,
    pub started_at: u128,
    /// Last time the lock file was rewritten. Every operation calls `touch()`, and a file write
    /// is milliseconds on Windows — the heartbeat is therefore throttled to a quarter of the
    /// stale window instead of running per query (it was 4 ms on every single read).
    last_beat: Cell<u128>,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn stale_ms() -> u128 {
    std::env::var("STARLINE_LOCK_STALE_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60_000)
}

fn host_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn write_lock(lock_path: &Path, started_at: u128) -> Result<()> {
    let payload = json!({
        "pid": std::process::id(),
        "host": host_name(),
        "startedAt": started_at,
        "heartbeatAt": now_ms(),
    });
    std::fs::write(lock_path, payload.to_string())?;
    Ok(())
}

/// Returns `(guard, locked_by_other)`. When another live instance holds the lock this process
/// does not touch the file and reports `locked_by_other = true` (the UI/banner decision is
/// made one layer up; M0 still allows writes — read-only enforcement lands with M1).
pub fn acquire(path: &Path) -> Result<(Option<LockGuard>, bool)> {
    let lock_path = PathBuf::from(format!("{}.lock", path.display()));
    if lock_path.exists() {
        let fresh = std::fs::read_to_string(&lock_path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("heartbeatAt").and_then(serde_json::Value::as_u64))
            .map(|h| now_ms().saturating_sub(h as u128) < stale_ms())
            .unwrap_or(false);
        if fresh {
            return Ok((None, true));
        }
    }
    let started_at = now_ms();
    write_lock(&lock_path, started_at)?;
    Ok((
        Some(LockGuard {
            path: lock_path,
            started_at,
            last_beat: Cell::new(started_at),
        }),
        false,
    ))
}

/// Rewrites the lock file at most every `stale_ms / 4`, so four heartbeats fit inside the stale
/// window while a read-heavy session does not pay a file write per operation.
pub fn heartbeat(guard: &LockGuard) {
    let now = now_ms();
    let interval = (stale_ms() / 4).max(1);
    if now.saturating_sub(guard.last_beat.get()) < interval {
        return;
    }
    if write_lock(&guard.path, guard.started_at).is_ok() {
        guard.last_beat.set(now);
    }
}

pub fn release(guard: LockGuard) {
    let _ = std::fs::remove_file(&guard.path);
}
