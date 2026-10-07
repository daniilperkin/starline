use base64::Engine as _;
use rusqlite::types::{Value as SqlVal, ValueRef};
use serde_json::{Map, Number, Value};

use crate::error::{Error, Result};

/// JSON -> SQLite parameter. `{"$b64": "..."}` denotes a blob; arrays are rejected.
pub fn json_to_sql(v: &Value) -> Result<SqlVal> {
    Ok(match v {
        Value::Null => SqlVal::Null,
        Value::Bool(b) => SqlVal::Integer(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlVal::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlVal::Real(f)
            } else {
                return Err("unsupported number".into());
            }
        }
        Value::String(s) => SqlVal::Text(s.clone()),
        Value::Object(o) => match o.get("$b64").and_then(Value::as_str) {
            Some(b) => SqlVal::Blob(
                base64::engine::general_purpose::STANDARD
                    .decode(b)
                    .map_err(|e| -> Error { Box::new(e) })?,
            ),
            None => return Err("unsupported object parameter (expected {\"$b64\": ...})".into()),
        },
        Value::Array(_) => return Err("array parameters are not supported".into()),
    })
}

/// SQLite value -> JSON. Blobs become `{"$b64": "..."}`.
pub fn sql_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(Number::from(i)),
        ValueRef::Real(f) => Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            let mut o = Map::new();
            o.insert(
                "$b64".to_string(),
                Value::String(base64::engine::general_purpose::STANDARD.encode(b)),
            );
            Value::Object(o)
        }
    }
}
