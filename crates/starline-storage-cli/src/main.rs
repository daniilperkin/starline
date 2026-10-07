//! Headless NDJSON front-end for `starline-storage`: one JSON request per line on stdin, one
//! JSON response per line on stdout. Used by the contract tests, the chaos harness and (via
//! the same protocol) the Tauri layer's dev mode.

use std::io::{BufRead, Write};
use std::path::Path;

use serde_json::{json, Value};
use starline_storage::Store;

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    let mut store: Option<Store> = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let (id, resp, shutdown) = match serde_json::from_str::<Value>(&line) {
            Ok(req) => {
                let id = req.get("id").cloned().unwrap_or(Value::Null);
                let op = req
                    .get("op")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let resp = handle(&op, &req, &mut store);
                (id, resp, op == "shutdown")
            }
            Err(e) => (Value::Null, Err(format!("bad request json: {e}")), false),
        };
        let msg = match resp {
            Ok(v) => json!({ "id": id, "ok": true, "result": v }),
            Err(e) => json!({ "id": id, "ok": false, "error": { "message": e } }),
        };
        if writeln!(out, "{msg}").is_err() {
            break;
        }
        let _ = out.flush();
        if shutdown {
            break;
        }
    }
    if let Some(s) = store.take() {
        let _ = s.close();
    }
}

fn handle(op: &str, req: &Value, store: &mut Option<Store>) -> Result<Value, String> {
    match op {
        "ping" => Ok(json!({ "pong": true })),
        "open" => {
            if store.is_some() {
                return Err("already open".to_string());
            }
            let path = req
                .get("path")
                .and_then(Value::as_str)
                .ok_or("open: path required")?;
            let create = req.get("create").and_then(Value::as_bool).unwrap_or(false);
            let read_only = req
                .get("readOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let (s, info) =
                Store::open(Path::new(path), create, read_only).map_err(|e| e.to_string())?;
            *store = Some(s);
            Ok(json!({
                "schemaVersion": info.schema_version,
                "applicationId": info.application_id,
                "revision": info.revision,
                "lockedByOther": info.locked_by_other,
            }))
        }
        "close" => {
            let s = store.take().ok_or("close: not open")?;
            s.close().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "query" => {
            let s = store.as_mut().ok_or("query: not open")?;
            let sql = req
                .get("sql")
                .and_then(Value::as_str)
                .ok_or("query: sql required")?;
            let params = req
                .get("params")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let rows = s.query(sql, &params).map_err(|e| e.to_string())?;
            Ok(Value::Array(rows.into_iter().map(Value::Object).collect()))
        }
        "exec" => {
            let s = store.as_mut().ok_or("exec: not open")?;
            let sql = req
                .get("sql")
                .and_then(Value::as_str)
                .ok_or("exec: sql required")?;
            let params = req
                .get("params")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let changed = s.exec(sql, &params).map_err(|e| e.to_string())?;
            Ok(json!({ "changed": changed }))
        }
        "exec_script" => {
            let s = store.as_mut().ok_or("exec_script: not open")?;
            let sql = req
                .get("sql")
                .and_then(Value::as_str)
                .ok_or("exec_script: sql required")?;
            s.exec_script(sql).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "begin" => {
            store
                .as_mut()
                .ok_or("begin: not open")?
                .begin()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "commit" => {
            store
                .as_mut()
                .ok_or("commit: not open")?
                .commit()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "rollback" => {
            store
                .as_mut()
                .ok_or("rollback: not open")?
                .rollback()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "snapshot" => {
            let s = store.as_mut().ok_or("snapshot: not open")?;
            let dest = req
                .get("dest")
                .and_then(Value::as_str)
                .ok_or("snapshot: dest required")?;
            let info = s.snapshot(Path::new(dest)).map_err(|e| e.to_string())?;
            Ok(
                json!({ "path": info.path, "byteSize": info.byte_size, "createdAt": info.created_at }),
            )
        }
        "integrity_check" => {
            let s = store.as_mut().ok_or("integrity_check: not open")?;
            let (ok, messages) = s.integrity_check().map_err(|e| e.to_string())?;
            Ok(json!({ "ok": ok, "messages": messages }))
        }
        "mtime" => {
            let s = store.as_ref().ok_or("mtime: not open")?;
            Ok(json!({ "mtimeMs": s.mtime_ms().map_err(|e| e.to_string())? }))
        }
        "shutdown" => Ok(Value::Null),
        other => Err(format!("unknown op: {other}")),
    }
}
