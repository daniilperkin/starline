import type { UUID } from "../primitives";
import type { SnapshotQueryRunner } from "./diff";
import {
  type ExtractedEntity,
  RESTORABLE_JOINS,
  RESTORABLE_TABLES,
  type RestorableKind,
} from "./types";

/**
 * "Restore single entity" (spec §4.5.3): pull one character, scene or lore entry — with the
 * join rows that belong to it — out of a snapshot and write it back into the live project.
 *
 * The copy is deliberately schema-generic: it reads `PRAGMA table_info` on both sides, copies
 * the columns they share, and upserts with `INSERT OR REPLACE`. That keeps working when the
 * schema moves on between the snapshot and now (an older snapshot simply carries fewer columns)
 * and avoids 20 hand-written copy statements that would drift.
 */

export interface SnapshotWriteRunner extends SnapshotQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

async function tableColumns(runner: SnapshotQueryRunner, table: string): Promise<string[]> {
  const rows = await runner.query<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((row) => String(row.name));
}

async function rowsWhere(
  runner: SnapshotQueryRunner,
  table: string,
  column: string,
  value: string,
): Promise<Array<Record<string, unknown>>> {
  return runner.query(`SELECT * FROM ${table} WHERE ${column} = ?`, [value]);
}

/** Reads everything that belongs to one entity out of a snapshot. */
export async function extractEntity(
  snapshot: SnapshotQueryRunner,
  kind: RestorableKind,
  id: string,
): Promise<ExtractedEntity> {
  const main = RESTORABLE_TABLES[kind];
  const tables: ExtractedEntity["tables"] = [];

  const mainRows = await rowsWhere(snapshot, main, "id", id);
  if (mainRows.length === 0)
    throw new Error(`nothing to restore: ${kind} ${id} is not in this snapshot`);
  tables.push({
    table: main,
    columns: await tableColumns(snapshot, main),
    rows: mainRows,
    skipped: 0,
  });

  const seen = new Set<string>([`${main}:${id}`]);
  for (const [table, column] of RESTORABLE_JOINS[kind]) {
    const rows = await rowsWhere(snapshot, table, column, id);
    if (rows.length === 0) continue;
    const fresh = rows.filter((row) => {
      const key = `${table}:${JSON.stringify(row)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length === 0) continue;
    tables.push({
      table,
      columns: await tableColumns(snapshot, table),
      rows: fresh,
      skipped: 0,
    });
  }
  return { kind, id: id as UUID, tables };
}

export interface SnapshotRestoreResult {
  restored: number;
  /** Rows the live database refused (a referenced row is gone, or the table changed). */
  skipped: number;
  notes: string[];
}

/**
 * Writes an extracted entity into the live project. Runs inside the caller's transaction, so a
 * failure anywhere leaves the project untouched. (Named `…FromSnapshot` because the trash has
 * its own `restoreEntity`, which un-deletes a row.)
 */
export async function restoreEntityFromSnapshot(
  current: SnapshotWriteRunner,
  entity: ExtractedEntity,
): Promise<SnapshotRestoreResult> {
  let restored = 0;
  let skipped = 0;
  const notes: string[] = [];

  for (const table of entity.tables) {
    const currentColumns = new Set(await tableColumns(current, table.table));
    const columns = table.columns.filter((column) => currentColumns.has(column));
    const dropped = table.columns.filter((column) => !currentColumns.has(column));
    if (dropped.length > 0) {
      notes.push(
        `${table.table}: dropped columns the current schema no longer has (${dropped.join(", ")})`,
      );
    }
    if (columns.length === 0) {
      skipped += table.rows.length;
      continue;
    }
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${table.table} (${columns.join(", ")}) VALUES (${placeholders})`;
    for (const row of table.rows) {
      try {
        await current.query(
          sql,
          columns.map((column) => (row[column] ?? null) as never),
        );
        restored += 1;
      } catch (cause) {
        skipped += 1;
        const message = cause instanceof Error ? cause.message : String(cause);
        notes.push(`${table.table}: skipped a row (${message})`);
      }
    }
  }
  return { restored, skipped, notes };
}

/** The entity kinds a snapshot can hand back, for the picker in the Backups screen. */
export async function listRestorableEntities(
  snapshot: SnapshotQueryRunner,
): Promise<Array<{ kind: RestorableKind; id: string; name: string }>> {
  const results: Array<{ kind: RestorableKind; id: string; name: string }> = [];
  for (const kind of ["character", "scene", "lore_entry"] as const) {
    const table = RESTORABLE_TABLES[kind];
    const nameColumn = kind === "scene" ? "title" : "name";
    const rows = await snapshot.query<{ id: string; name: string }>(
      `SELECT id, ${nameColumn} AS name FROM ${table} WHERE deleted_at IS NULL ORDER BY ${nameColumn}`,
    );
    for (const row of rows) {
      results.push({ kind, id: String(row.id), name: String(row.name ?? "") });
    }
  }
  return results;
}
