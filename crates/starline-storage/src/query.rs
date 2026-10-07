use rusqlite::params_from_iter;
use serde_json::{Map, Value};

use crate::error::Result;
use crate::json::{json_to_sql, sql_to_json};
use crate::Store;

impl Store {
    /// Run a parameterised statement; returns rows as plain JSON objects.
    pub fn query(&mut self, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>> {
        self.touch();
        let param_values = params.iter().map(json_to_sql).collect::<Result<Vec<_>>>()?;
        let mut stmt = self.conn.prepare(sql)?;
        let col_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(str::to_string)
            .collect();
        let mut rows = stmt.query(params_from_iter(param_values.iter()))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let mut obj = Map::with_capacity(col_names.len());
            for (i, name) in col_names.iter().enumerate() {
                obj.insert(name.clone(), sql_to_json(row.get_ref(i)?));
            }
            out.push(obj);
        }
        Ok(out)
    }

    /// Run a single non-returning statement; returns the number of changed rows.
    pub fn exec(&mut self, sql: &str, params: &[Value]) -> Result<usize> {
        self.touch();
        let param_values = params.iter().map(json_to_sql).collect::<Result<Vec<_>>>()?;
        Ok(self
            .conn
            .execute(sql, params_from_iter(param_values.iter()))?)
    }

    /// Run a multi-statement script (used by the migration runner; triggers contain semicolons).
    pub fn exec_script(&mut self, sql: &str) -> Result<()> {
        self.touch();
        self.conn.execute_batch(sql)?;
        Ok(())
    }

    pub fn begin(&mut self) -> Result<()> {
        if self.in_tx {
            return Err("already in a transaction".into());
        }
        if self.read_only {
            return Err("read-only connection".into());
        }
        self.conn.execute_batch("BEGIN IMMEDIATE;")?;
        self.in_tx = true;
        Ok(())
    }

    pub fn commit(&mut self) -> Result<()> {
        if !self.in_tx {
            return Err("no transaction in progress".into());
        }
        self.conn.execute_batch("COMMIT;")?;
        self.in_tx = false;
        Ok(())
    }

    pub fn rollback(&mut self) -> Result<()> {
        if !self.in_tx {
            return Err("no transaction in progress".into());
        }
        self.conn.execute_batch("ROLLBACK;")?;
        self.in_tx = false;
        Ok(())
    }
}
