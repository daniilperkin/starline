/**
 * Writing an exported project back into a library (spec §4.5.2, §5.4.2 rules).
 *
 * The interchange formats carry every row id, so an import into a fresh library is a byte-for-byte
 * reconstruction — that is what makes `export → import → export` identical. Ids that already
 * exist in the target library are re-mapped (a merged import never overwrites), and because every
 * reference is re-mapped through the same table, the imported copy stays internally consistent.
 */
import type { SqlRunner, SqlValue } from "../commands";
import { syncMentions } from "../lore/mentions";
import type { UUID } from "../primitives";
import { epochNow, newUuid } from "../primitives";
import type { PMDoc } from "../richtext";
import {
  EXPORT_TABLES,
  type ExportRow,
  insertList,
  type ProjectExport,
  placeholders,
} from "./types";

const META_GRAPH_POSITIONS = "graph_positions";

/** Rich-text columns hold `{json, text}` (or a bare doc); mentions only need the doc. */
function parseDoc(value: string | null): PMDoc | null {
  if (value === null || value.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === "object") {
      const wrapper = parsed as { json?: unknown };
      if (wrapper.json !== undefined) return wrapper.json as PMDoc | null;
      return parsed as PMDoc;
    }
    return null;
  } catch {
    return null;
  }
}

/** Columns that point at another table's id, per physical table. */
export const REFERENCES: Record<string, Record<string, string>> = {
  project: { series_id: "series" },
  snowflake_step: { project_id: "project" },
  relationship_group: { project_id: "project" },
  character: { project_id: "project" },
  part: { project_id: "project" },
  chapter: { project_id: "project", part_id: "part" },
  lore_category: { project_id: "project", parent_id: "lore_category" },
  lore_entry: {
    project_id: "project",
    category_id: "lore_category",
    parent_entry_id: "lore_entry",
  },
  plotline: { project_id: "project", character_id: "character" },
  scene: {
    project_id: "project",
    chapter_id: "chapter",
    pov_character_id: "character",
    location_id: "lore_entry",
  },
  scene_character: { scene_id: "scene", character_id: "character" },
  scene_lore: { scene_id: "scene", lore_entry_id: "lore_entry" },
  scene_plotline: { scene_id: "scene", plotline_id: "plotline" },
  character_relationship: {
    project_id: "project",
    source_id: "character",
    target_id: "character",
    group_id: "relationship_group",
    starts_at_scene_id: "scene",
    ends_at_scene_id: "scene",
  },
  timeline_event: {
    project_id: "project",
    character_id: "character",
    plotline_id: "plotline",
    scene_id: "scene",
    lore_entry_id: "lore_entry",
  },
  idea_note: { project_id: "project" },
  tag: { project_id: "project" },
  custom_field_def: { project_id: "project" },
  custom_field_value: { def_id: "custom_field_def" },
  entity_link: { project_id: "project" },
  attachment: { project_id: "project" },
  character_gallery: { character_id: "character", attachment_id: "attachment" },
};

/** Entity-type strings used by `entity_tag` / `entity_link` mapped to their tables. */
const ENTITY_TYPE_TABLE: Record<string, string> = {
  character: "character",
  scene: "scene",
  chapter: "chapter",
  part: "part",
  lore: "lore_entry",
  lore_entry: "lore_entry",
  note: "idea_note",
  plotline: "plotline",
  timeline_event: "timeline_event",
};

export interface ImportIssue {
  severity: "error" | "warning";
  message: string;
  /** Table or file the issue is about, when known. */
  where?: string;
}

export interface ImportReport {
  projectId: UUID;
  title: string;
  /** Rows written per export key. */
  counts: Record<string, number>;
  /** Rows whose id had to change because the target library already used it. */
  remapped: number;
  issues: ImportIssue[];
}

export interface ImportOptions {
  /** Force the project id (used when the caller created one already). */
  projectId?: UUID;
  /** Suffix appended to the title when it collides, e.g. " (imported)". */
  titleSuffix?: string;
}

/** True when the row object carries the columns of one export table. */
function isRow(value: unknown): value is ExportRow {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The folder format deliberately carries no timestamps (markdown.ts), so a folder import would
 * hit `NOT NULL` on `created_at`/`updated_at` for every row. Fill them at the door: a re-import
 * gets "now", which is exactly what the writer expects to see for the rows they just brought in.
 */
function withTimestamps(row: ExportRow, columns: readonly string[], now: number): ExportRow {
  const filled: ExportRow = { ...row };
  for (const column of ["created_at", "updated_at"] as const) {
    if (columns.includes(column) && (filled[column] === undefined || filled[column] === null)) {
      filled[column] = now;
    }
  }
  return filled;
}

/** JSON columns are stored as text in the database, exactly as the exporter found them. */
function toDatabaseValue(value: unknown, isJson: boolean): SqlValue {
  if (value === null || value === undefined) return null;
  if (isJson) return typeof value === "string" ? value : JSON.stringify(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

class Remapper {
  private readonly map = new Map<string, string>();

  private key(table: string, id: string): string {
    return `${table}\u0000${id}`;
  }

  set(table: string, from: string, to: string): void {
    this.map.set(this.key(table, from), to);
  }

  get(table: string, id: unknown): unknown {
    if (typeof id !== "string") return id;
    return this.map.get(this.key(table, id)) ?? id;
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * Assigns an id to every incoming row: keep the exported one when the target library is free of
 * it, otherwise allocate a fresh UUID. Runs before any insert so that references can be re-mapped
 * in the same pass as the ids they point at.
 */
async function planIds(
  tx: SqlRunner,
  data: ProjectExport,
  options: ImportOptions,
): Promise<{ remap: Remapper; projectId: UUID; title: string; count: number }> {
  const remap = new Remapper();
  let count = 0;

  const allocate = async (table: string, id: string): Promise<string> => {
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = ? LIMIT 1`,
      [id],
    );
    if (existing.length === 0) return id;
    count += 1;
    const fresh = newUuid();
    remap.set(table, id, fresh);
    return fresh;
  };

  // Series first: the project references it.
  if (data.series !== null) {
    const seriesId = data.series.id;
    if (typeof seriesId === "string") await allocate("series", seriesId);
  }

  const projectId =
    options.projectId !== undefined
      ? options.projectId
      : ((await allocate("project", String(data.project.id))) as UUID);
  if (options.projectId !== undefined && options.projectId !== data.project.id) {
    count += 1;
    remap.set("project", String(data.project.id), options.projectId);
  }

  for (const spec of EXPORT_TABLES) {
    for (const row of data.tables[spec.key] ?? []) {
      const id = row.id;
      // Join tables have composite keys and no `id` column: their rows are new by definition
      // only when the entities they point at were re-mapped, which the column pass handles.
      if (typeof id === "string") await allocate(spec.table, id);
    }
  }

  let title = String(data.project.title ?? "Untitled");
  if (options.titleSuffix !== undefined && options.titleSuffix.length > 0) {
    const taken = await tx.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM project WHERE title = ? AND deleted_at IS NULL",
      [title],
    );
    if (Number(taken[0]?.n ?? 0) > 0) title = `${title}${options.titleSuffix}`;
  }

  return { remap, projectId, title, count };
}

/** (typeColumn, idColumn) pairs whose target table depends on the row's own type string. */
const ENTITY_REFERENCE_COLUMNS: Record<string, Array<[string, string]>> = {
  entity_tag: [["entity_type", "entity_id"]],
  entity_link: [
    ["from_type", "from_id"],
    ["to_type", "to_id"],
  ],
};

function mapRow(
  table: string,
  row: ExportRow,
  remap: Remapper,
  jsonColumns: readonly string[],
  /** Column order to emit — defaults to the row's own key order (the project insert relies on it). */
  order?: readonly string[],
): SqlValue[] {
  const references = REFERENCES[table] ?? {};
  const entityRefs = ENTITY_REFERENCE_COLUMNS[table] ?? [];
  return (order ?? Object.keys(row)).map((column) => {
    let value = row[column];
    // The row's own id is re-mapped last of all — a table without one (join tables) simply
    // keeps whatever the column holds.
    if (column === "id") return toDatabaseValue(remap.get(table, value), false);
    const target = references[column];
    if (target !== undefined) value = remap.get(target, value);
    for (const [typeColumn, idColumn] of entityRefs) {
      if (column !== idColumn) continue;
      const entityTable = ENTITY_TYPE_TABLE[String(row[typeColumn] ?? "")];
      if (entityTable !== undefined) value = remap.get(entityTable, value);
    }
    return toDatabaseValue(value, jsonColumns.includes(column));
  });
}

/**
 * Writes a parsed export into the library. Everything happens inside the caller's transaction:
 * a failed import leaves the library exactly as it was.
 */
export async function writeProjectExport(
  tx: SqlRunner,
  data: ProjectExport,
  options: ImportOptions = {},
): Promise<ImportReport> {
  const issues: ImportIssue[] = [];
  const { remap, projectId, title, count } = await planIds(tx, data, options);
  const now = epochNow();

  // The project row points at its cover attachment and every attachment points back at the
  // project — a cycle no insert order can satisfy, so FK checks wait until the transaction ends.
  await tx.execScript("PRAGMA defer_foreign_keys = ON");

  // Series (never re-created when it already exists under the same id).
  if (data.series !== null && isRow(data.series)) {
    const seriesId = remap.get("series", data.series.id);
    await tx.query(
      `INSERT OR IGNORE INTO series (id, title, description_json, description_text, order_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(seriesId),
        String(data.series.title ?? "Series"),
        toDatabaseValue(data.series.description_json, true),
        String(data.series.description_text ?? ""),
        String(data.series.order_key ?? "a0"),
        toDatabaseValue(data.series.created_at, false) ?? now,
        toDatabaseValue(data.series.updated_at, false) ?? now,
      ],
    );
  }

  // Project.
  const projectRow = withTimestamps(data.project, ["created_at", "updated_at"], now);
  const projectColumns = Object.keys(projectRow);
  await tx.query(
    `INSERT INTO project (${projectColumns.join(", ")}) VALUES (${projectColumns.map(() => "?").join(", ")})`,
    mapRow("project", { ...projectRow, id: remap.get("project", data.project.id), title }, remap, [
      "genres",
      "settings",
      "description_json",
    ]),
  );

  // Every table in foreign-key-safe order.
  const counts: Record<string, number> = {};
  for (const spec of EXPORT_TABLES) {
    const rows = data.tables[spec.key] ?? [];
    counts[spec.key] = 0;
    for (const row of rows) {
      try {
        await tx.query(
          `INSERT INTO ${spec.table} (${insertList(spec)}) VALUES (${placeholders(spec)})`,
          mapRow(
            spec.table,
            withTimestamps(row, spec.columns, now),
            remap,
            spec.jsonColumns,
            spec.columns,
          ),
        );
        counts[spec.key] = (counts[spec.key] ?? 0) + 1;
      } catch (cause) {
        // One broken row must not lose the other 500: report and keep going.
        issues.push({
          severity: "error",
          where: `${spec.table}:${String(row.id ?? "?")}`,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }

  // Attachment bytes (folder format only): the metadata rows just landed, so the blobs can
  // follow with their re-mapped ids. A row without bytes stays metadata-only and is reported.
  const attachmentRows = data.tables.attachments ?? [];
  if (attachmentRows.length > 0) {
    const byteMap = data.attachmentData ?? {};
    for (const row of attachmentRows) {
      const id = typeof row.id === "string" ? row.id : null;
      if (id === null) continue;
      const bytes = byteMap[id];
      if (bytes === undefined) {
        issues.push({
          severity: "warning",
          where: `attachment:${id}`,
          message: "no bytes in the archive — the attachment imported without its file",
        });
        continue;
      }
      try {
        await tx.query(`INSERT INTO attachment_blob (attachment_id, data) VALUES (?, ?)`, [
          String(remap.get("attachment", id)),
          bytes,
        ]);
      } catch (cause) {
        issues.push({
          severity: "error",
          where: `attachment_blob:${id}`,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }

  // Mentions are derived data: rebuild them from the rich text the import just wrote, so
  // backlinks work immediately after an import without shipping a mirror table (spec §3.9).
  const scenes = await tx.query<{
    id: string;
    synopsis_json: string | null;
    body_json: string | null;
  }>("SELECT id, synopsis_json, body_json FROM scene WHERE project_id = ? AND deleted_at IS NULL", [
    projectId,
  ]);
  for (const scene of scenes) {
    await syncMentions(tx, "scene", scene.id as UUID, "synopsis", parseDoc(scene.synopsis_json));
    await syncMentions(tx, "scene", scene.id as UUID, "body", parseDoc(scene.body_json));
  }
  const characters = await tx.query<{ id: string; storyline_json: string | null }>(
    "SELECT id, storyline_json FROM character WHERE project_id = ? AND deleted_at IS NULL",
    [projectId],
  );
  for (const character of characters) {
    await syncMentions(
      tx,
      "character",
      character.id as UUID,
      "storyline",
      parseDoc(character.storyline_json),
    );
  }
  const entries = await tx.query<{ id: string; body_json: string | null }>(
    "SELECT id, body_json FROM lore_entry WHERE project_id = ? AND deleted_at IS NULL",
    [projectId],
  );
  for (const entry of entries) {
    await syncMentions(tx, "lore", entry.id as UUID, "body", parseDoc(entry.body_json));
  }
  const notes = await tx.query<{ id: string; body_json: string | null }>(
    "SELECT id, body_json FROM idea_note WHERE project_id = ? AND deleted_at IS NULL",
    [projectId],
  );
  for (const note of notes) {
    await syncMentions(tx, "note", note.id as UUID, "body", parseDoc(note.body_json));
  }

  // Graph pins: merged under the (possibly re-mapped) project id.
  if (Object.keys(data.graphPositions).length > 0) {
    const rows = await tx.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
      META_GRAPH_POSITIONS,
    ]);
    let all: Record<string, unknown> = {};
    try {
      all = rows[0] !== undefined ? (JSON.parse(rows[0].value) as Record<string, unknown>) : {};
    } catch {
      all = {};
    }
    const pins: Record<string, { x: number; y: number }> = {};
    for (const [characterId, position] of Object.entries(data.graphPositions)) {
      const mapped = remap.get("character", characterId);
      pins[typeof mapped === "string" ? mapped : characterId] = position;
    }
    all[projectId] = pins;
    await tx.query(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [META_GRAPH_POSITIONS, JSON.stringify(all)],
    );
  }

  // One revision bump for the whole import, the same way a command would report the change.
  await tx.query(
    "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'revision'",
  );

  return { projectId, title, counts, remapped: count, issues };
}
