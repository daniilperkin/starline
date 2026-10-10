import type { SnapshotQueryRunner } from "./diff";

/**
 * The `snapshot_record` index (spec §3.9): a convenience row per snapshot file, so the Backups
 * screen can show reason, counts and label without opening each file. The FILES are
 * authoritative — `reconcileSnapshotRecords` is what keeps the two honest when a file is
 * deleted outside the app, or when a snapshot was taken before this table was written.
 */

export interface SnapshotRecord {
  id: string;
  createdAt: number;
  reason: string;
  fileName: string;
  byteSize: number;
  schemaVersion: number;
  wordCount: number;
  sceneCount: number;
  label: string;
}

export interface SnapshotRecordInput {
  fileName: string;
  createdAt: number;
  reason: string;
  byteSize: number;
  schemaVersion: number;
  wordCount: number;
  sceneCount: number;
  label?: string;
}

/** File names are unique by construction, so they double as the record's primary key. */
export function recordId(fileName: string): string {
  return fileName;
}

export async function recordSnapshot(
  runner: SnapshotQueryRunner & {
    query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  },
  input: SnapshotRecordInput,
): Promise<void> {
  await runner.query(
    `INSERT OR REPLACE INTO snapshot_record
       (id, created_at, reason, file_name, byte_size, schema_version, word_count, scene_count, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recordId(input.fileName),
      input.createdAt,
      input.reason,
      input.fileName,
      input.byteSize,
      input.schemaVersion,
      input.wordCount,
      input.sceneCount,
      input.label ?? "",
    ],
  );
}

export async function listSnapshotRecords(runner: SnapshotQueryRunner): Promise<SnapshotRecord[]> {
  const rows = await runner.query<{
    id: string;
    created_at: number;
    reason: string;
    file_name: string;
    byte_size: number;
    schema_version: number;
    word_count: number;
    scene_count: number;
    label: string;
  }>("SELECT * FROM snapshot_record ORDER BY created_at DESC");
  return rows.map((row) => ({
    id: String(row.id),
    createdAt: Number(row.created_at),
    reason: String(row.reason),
    fileName: String(row.file_name),
    byteSize: Number(row.byte_size),
    schemaVersion: Number(row.schema_version),
    wordCount: Number(row.word_count),
    sceneCount: Number(row.scene_count),
    label: String(row.label ?? ""),
  }));
}

export interface ReconcileResult {
  added: number;
  removed: number;
}

/**
 * Aligns the index with what is actually on disk: rows whose file is gone are dropped, files
 * without a row are added (a snapshot written by an older build, or by another device's copy).
 */
export async function reconcileSnapshotRecords(
  runner: SnapshotQueryRunner & {
    query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  },
  files: ReadonlyArray<{ name: string; createdAt: number; byteSize: number; reason: string }>,
): Promise<ReconcileResult> {
  const records = await listSnapshotRecords(runner);
  const byFile = new Map(records.map((record) => [record.fileName, record]));
  const present = new Set(files.map((file) => file.name));
  let added = 0;
  let removed = 0;

  for (const record of records) {
    if (present.has(record.fileName)) continue;
    await runner.query("DELETE FROM snapshot_record WHERE id = ?", [record.id]);
    removed += 1;
  }
  for (const file of files) {
    if (byFile.has(file.name)) continue;
    await runner.query(
      `INSERT OR REPLACE INTO snapshot_record
         (id, created_at, reason, file_name, byte_size, schema_version, word_count, scene_count, label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [recordId(file.name), file.createdAt, file.reason, file.name, file.byteSize, 0, 0, 0, ""],
    );
    added += 1;
  }
  return { added, removed };
}

/** Counts a snapshot record needs, read from the live database at snapshot time. */
export async function readRecordCounts(
  runner: SnapshotQueryRunner,
): Promise<{ wordCount: number; sceneCount: number; schemaVersion: number }> {
  const rows = await runner.query<{ n: number; words: number; version: number }>(
    `SELECT (SELECT COUNT(*) FROM scene WHERE deleted_at IS NULL) AS n,
            (SELECT COALESCE(SUM(body_word_count), 0) FROM scene WHERE deleted_at IS NULL) AS words,
            (SELECT user_version FROM pragma_user_version) AS version`,
  );
  const row = rows[0];
  return {
    wordCount: Number(row?.words ?? 0),
    sceneCount: Number(row?.n ?? 0),
    schemaVersion: Number(row?.version ?? 0),
  };
}
