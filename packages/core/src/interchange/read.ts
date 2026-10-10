/**
 * Reading one project out of the library (spec §4.5.1). One pass per table, in the same order
 * the importer writes them, so the export can be inserted with foreign keys ON.
 */
import type { SqlRunner, SqlValue } from "../commands";
import type { UUID } from "../primitives";
import { EXPORT_TABLES, type ExportRow, type ProjectExport, selectList } from "./types";

const PROJECT_COLUMNS = [
  "id",
  "series_id",
  "series_order_key",
  "title",
  "subtitle",
  "author_name",
  "form",
  "method",
  "genres",
  "logline",
  "description_json",
  "description_text",
  "target_word_count",
  "deadline",
  "cover_attachment_id",
  "archived",
  "settings",
  "created_at",
  "updated_at",
] as const;

const PROJECT_JSON_COLUMNS = new Set(["genres", "settings", "description_json"]);

const SERIES_COLUMNS = [
  "id",
  "title",
  "description_json",
  "description_text",
  "order_key",
  "created_at",
  "updated_at",
] as const;

const META_GRAPH_POSITIONS = "graph_positions";

function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    // A hand-edited file must still export: keep the raw text rather than throwing.
    return value;
  }
}

function pickColumns(
  row: Record<string, unknown>,
  columns: readonly string[],
  jsonColumns: ReadonlySet<string> | readonly string[],
): ExportRow {
  const json =
    jsonColumns instanceof Set ? jsonColumns : (new Set(jsonColumns) as ReadonlySet<string>);
  const out: ExportRow = {};
  for (const column of columns) {
    const value = row[column];
    out[column] = json.has(column) ? parseJsonColumn(value) : (value ?? null);
  }
  return out;
}

/** Reads every table of one project (soft-deleted rows excluded — trash is not content). */
export async function readProjectExport(
  // Only reads: the driver the app already holds qualifies without pretending to be a command runner.
  reader: Pick<SqlRunner, "query">,
  projectId: UUID,
  options: { includeAttachments?: boolean } = {},
): Promise<ProjectExport> {
  const includeAttachments = options.includeAttachments === true;
  const projectRows = await reader.query<Record<string, unknown>>(
    `SELECT ${PROJECT_COLUMNS.join(", ")} FROM project WHERE id = ?`,
    [projectId],
  );
  const projectRow = projectRows[0];
  if (projectRow === undefined) throw new Error(`project not found: ${projectId}`);
  const project = pickColumns(projectRow, PROJECT_COLUMNS, PROJECT_JSON_COLUMNS);
  // A JSON export carries no attachment rows, so it must not point at one either.
  if (!includeAttachments) project.cover_attachment_id = null;

  let series: ExportRow | null = null;
  const seriesId = project.series_id;
  if (typeof seriesId === "string" && seriesId.length > 0) {
    const rows = await reader.query<Record<string, unknown>>(
      `SELECT ${SERIES_COLUMNS.join(", ")} FROM series WHERE id = ?`,
      [seriesId],
    );
    if (rows[0] !== undefined) {
      series = pickColumns(rows[0], SERIES_COLUMNS, ["description_json"]);
    }
  }

  const tables: Record<string, ExportRow[]> = {};
  for (const spec of EXPORT_TABLES) {
    if (spec.zipOnly === true && !includeAttachments) {
      tables[spec.key] = [];
      continue;
    }
    const columns = selectList(spec);
    const orderBy = spec.orderBy
      .split(",")
      .map((part) => part.trim())
      .join(", ");
    const alive = spec.softDelete === false ? "" : " AND deleted_at IS NULL";
    let sql: string;
    let params: SqlValue[] = [];
    switch (spec.scope.kind) {
      case "project":
        sql = `SELECT ${columns} FROM ${spec.table} WHERE ${spec.scope.column} = ?${alive} ORDER BY ${orderBy}`;
        params = [projectId];
        break;
      case "subquery":
        // Join tables have no `deleted_at` of their own; their parents already filtered.
        sql = `SELECT ${columns} FROM ${spec.table} WHERE ${spec.scope.where} ORDER BY ${orderBy}`;
        params = [projectId];
        break;
      default:
        sql = `SELECT ${columns} FROM ${spec.table} ORDER BY ${orderBy}`;
        break;
    }
    const rows = await reader.query<Record<string, unknown>>(sql, params);
    const mapped = rows.map((row) => pickColumns(row, spec.columns, spec.jsonColumns));
    if (!includeAttachments && spec.nullColumns !== undefined) {
      for (const row of mapped) {
        for (const column of spec.nullColumns) {
          if (column in row) row[column] = null;
        }
      }
    }
    tables[spec.key] = mapped;
  }

  const metaRows = await reader.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
    META_GRAPH_POSITIONS,
  ]);
  let graphPositions: Record<string, { x: number; y: number }> = {};
  const all = parseJsonColumn(metaRows[0]?.value ?? null);
  if (all !== null && typeof all === "object") {
    const entry = (all as Record<string, unknown>)[projectId];
    if (entry !== null && typeof entry === "object") {
      graphPositions = entry as Record<string, { x: number; y: number }>;
    }
  }

  const exportData: ProjectExport = { project, series, graphPositions, tables };
  if (includeAttachments) {
    const blobRows = await reader.query<{ attachment_id: string; data: Uint8Array | null }>(
      `SELECT b.attachment_id, b.data FROM attachment_blob b
         JOIN attachment a ON a.id = b.attachment_id
        WHERE a.project_id = ?`,
      [projectId],
    );
    const attachmentData: Record<string, Uint8Array> = {};
    for (const row of blobRows) {
      if (row.data !== null) attachmentData[row.attachment_id] = row.data;
    }
    if (Object.keys(attachmentData).length > 0) exportData.attachmentData = attachmentData;
  }
  return exportData;
}
