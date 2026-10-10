/**
 * Export/import model (spec §4.5.1, §5.4.2). One description of every table the interchange
 * formats carry, used by BOTH the writer and the reader — a spec drift between the two is the
 * one bug class the round-trip gate cannot forgive, so there is exactly one list.
 */
import type { SqlValue } from "../commands";

/** Tables that belong to a project and how to select them. */
export type ExportScope =
  | { kind: "project"; column: string }
  | { kind: "subquery"; where: string }
  | { kind: "none" };

export interface ExportTableSpec {
  /** Key in the JSON payload and the Markdown folder. */
  readonly key: string;
  /** Physical table name. */
  readonly table: string;
  /** Columns written and read, in a fixed order. */
  readonly columns: readonly string[];
  /** Columns holding JSON text that is exported as parsed JSON. */
  readonly jsonColumns: readonly string[];
  /** Deterministic ordering for the export and for frontmatter-free formats. */
  readonly orderBy: string;
  /** False for tables that have no `deleted_at` (they are never trashed). */
  readonly softDelete?: boolean;
  readonly scope: ExportScope;
}

/** Columns quoted because they are SQL keywords. */
const q = (name: string): string => (name === "values" ? `"values"` : name);

const CHARACTER_COLUMNS = [
  "id",
  "project_id",
  "name",
  "aliases",
  "role",
  "color",
  "pronouns",
  "age",
  "birth_story_date",
  "occupation",
  "one_line",
  "one_paragraph_json",
  "one_paragraph_text",
  "motivation",
  "goal",
  "conflict",
  "epiphany",
  "want",
  "need",
  "lie",
  "truth",
  "flaws",
  "strengths",
  "fears",
  "values",
  "internal_conflict_json",
  "internal_conflict_text",
  "external_conflict_json",
  "external_conflict_text",
  "arc_type",
  "ghost_json",
  "ghost_text",
  "voice_notes_json",
  "voice_notes_text",
  "appearance_json",
  "appearance_text",
  "backstory_json",
  "backstory_text",
  "storyline_json",
  "storyline_text",
  "bible_json",
  "bible_text",
  "order_key",
  "pinned",
  "created_at",
  "updated_at",
] as const;

const SCENE_COLUMNS = [
  "id",
  "project_id",
  "chapter_id",
  "order_key",
  "title",
  "synopsis_json",
  "synopsis_text",
  "pov_character_id",
  "location_id",
  "objective",
  "obstacle",
  "outcome",
  "outcome_note",
  "emotion_start",
  "emotion_end",
  "status",
  "body_json",
  "body_text",
  "body_word_count",
  "target_word_count",
  "story_time",
  "story_time_label",
  "time_of_day",
  "color",
  "is_flashback",
  "snowflake_source",
  "created_at",
  "updated_at",
] as const;

/**
 * Every table of one project, in an order that can be inserted with foreign keys ON: a table
 * appears after everything it references. Self-references (category/entry parents) and the
 * graph positions are patched in a second pass by the importer.
 */
export const EXPORT_TABLES: readonly ExportTableSpec[] = [
  {
    key: "snowflakeSteps",
    table: "snowflake_step",
    columns: [
      "id",
      "project_id",
      "step",
      "status",
      "content",
      "completed_at",
      "overrides",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["content", "overrides"],
    orderBy: "step",
    softDelete: false,
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "characters",
    table: "character",
    columns: CHARACTER_COLUMNS,
    jsonColumns: [
      "aliases",
      "flaws",
      "strengths",
      "fears",
      "values",
      "one_paragraph_json",
      "internal_conflict_json",
      "external_conflict_json",
      "ghost_json",
      "voice_notes_json",
      "appearance_json",
      "backstory_json",
      "storyline_json",
      "bible_json",
    ],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "relationshipGroups",
    table: "relationship_group",
    columns: ["id", "project_id", "name", "color", "order_key", "created_at", "updated_at"],
    jsonColumns: [],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "parts",
    table: "part",
    columns: [
      "id",
      "project_id",
      "title",
      "summary_json",
      "summary_text",
      "order_key",
      "color",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["summary_json"],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "chapters",
    table: "chapter",
    columns: [
      "id",
      "project_id",
      "part_id",
      "title",
      "summary_json",
      "summary_text",
      "order_key",
      "target_word_count",
      "color",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["summary_json"],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "loreCategories",
    table: "lore_category",
    columns: [
      "id",
      "project_id",
      "parent_id",
      "name",
      "icon",
      "order_key",
      "color",
      "default_kind",
      "created_at",
      "updated_at",
    ],
    jsonColumns: [],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "loreEntries",
    table: "lore_entry",
    columns: [
      "id",
      "project_id",
      "category_id",
      "parent_entry_id",
      "kind",
      "custom_kind_label",
      "name",
      "aliases",
      "summary",
      "body_json",
      "body_text",
      "coordinates",
      "order_key",
      "pinned",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["aliases", "body_json", "coordinates"],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "plotlines",
    table: "plotline",
    columns: [
      "id",
      "project_id",
      "name",
      "description_json",
      "description_text",
      "color",
      "order_key",
      "kind",
      "character_id",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["description_json"],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "scenes",
    table: "scene",
    columns: SCENE_COLUMNS,
    jsonColumns: ["synopsis_json", "body_json", "snowflake_source"],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "sceneCharacters",
    table: "scene_character",
    columns: ["scene_id", "character_id", "presence"],
    jsonColumns: [],
    orderBy: "scene_id, character_id",
    scope: {
      kind: "subquery",
      where: "scene_id IN (SELECT id FROM scene WHERE project_id = ?)",
    },
  },
  {
    key: "sceneLore",
    table: "scene_lore",
    columns: ["scene_id", "lore_entry_id"],
    jsonColumns: [],
    orderBy: "scene_id, lore_entry_id",
    scope: {
      kind: "subquery",
      where: "scene_id IN (SELECT id FROM scene WHERE project_id = ?)",
    },
  },
  {
    key: "scenePlotlines",
    table: "scene_plotline",
    columns: ["scene_id", "plotline_id", "beat"],
    jsonColumns: [],
    orderBy: "scene_id, plotline_id",
    scope: {
      kind: "subquery",
      where: "scene_id IN (SELECT id FROM scene WHERE project_id = ?)",
    },
  },
  {
    key: "relationships",
    table: "character_relationship",
    columns: [
      "id",
      "project_id",
      "source_id",
      "target_id",
      "kind",
      "custom_label",
      "directed",
      "sentiment",
      "notes_json",
      "notes_text",
      "group_id",
      "starts_at_scene_id",
      "ends_at_scene_id",
      "secret",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["notes_json"],
    orderBy: "source_id, target_id, kind, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "timelineEvents",
    table: "timeline_event",
    columns: [
      "id",
      "project_id",
      "title",
      "description_json",
      "description_text",
      "story_time",
      "story_time_end",
      "story_time_label",
      "lane",
      "character_id",
      "plotline_id",
      "scene_id",
      "lore_entry_id",
      "color",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["description_json"],
    orderBy: "story_time, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "notes",
    table: "idea_note",
    columns: [
      "id",
      "project_id",
      "title",
      "kind",
      "status",
      "body_json",
      "body_text",
      "source_url",
      "pinned",
      "color",
      "promoted_to_type",
      "promoted_to_id",
      "order_key",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["body_json"],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "tags",
    table: "tag",
    columns: ["id", "project_id", "name", "color", "created_at"],
    jsonColumns: [],
    orderBy: "name, id",
    softDelete: false,
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "entityTags",
    table: "entity_tag",
    columns: ["tag_id", "entity_type", "entity_id"],
    jsonColumns: [],
    orderBy: "tag_id, entity_type, entity_id",
    scope: {
      kind: "subquery",
      where: "tag_id IN (SELECT id FROM tag WHERE project_id = ?)",
    },
  },
  {
    key: "fieldDefs",
    table: "custom_field_def",
    columns: [
      "id",
      "project_id",
      "target",
      "lore_kind",
      "label",
      "type",
      "options",
      "entity_ref_target",
      "required",
      "order_key",
      "section",
      "created_at",
      "updated_at",
    ],
    jsonColumns: ["options"],
    orderBy: "order_key, id",
    scope: { kind: "project", column: "project_id" },
  },
  {
    key: "fieldValues",
    table: "custom_field_value",
    columns: ["id", "def_id", "owner_type", "owner_id", "value", "updated_at"],
    jsonColumns: ["value"],
    orderBy: "def_id, owner_type, owner_id",
    scope: {
      kind: "subquery",
      where: "def_id IN (SELECT id FROM custom_field_def WHERE project_id = ?)",
    },
  },
  {
    key: "entityLinks",
    table: "entity_link",
    columns: [
      "id",
      "project_id",
      "from_type",
      "from_id",
      "to_type",
      "to_id",
      "kind",
      "note",
      "created_at",
    ],
    jsonColumns: [],
    orderBy: "from_type, from_id, kind, id",
    softDelete: false,
    scope: { kind: "project", column: "project_id" },
  },
] as const;

/** Column list for a SELECT, with reserved words quoted. */
export function selectList(spec: ExportTableSpec): string {
  return spec.columns.map((column) => q(column)).join(", ");
}

/** Column list for an INSERT, with reserved words quoted. */
export function insertList(spec: ExportTableSpec): string {
  return spec.columns.map((column) => q(column)).join(", ");
}

export function placeholders(spec: ExportTableSpec): string {
  return spec.columns.map(() => "?").join(", ");
}

/** A row of an exported table: column name → value (JSON columns hold parsed JSON). */
export type ExportRow = Record<string, SqlValue | unknown>;

/** One project, ready to be written out in any format. */
export interface ProjectExport {
  project: ExportRow;
  /** Series row when the project belongs to one (exported once, not per project). */
  series: ExportRow | null;
  /** Relationship-graph pins for this project (`meta.graph_positions` entry). */
  graphPositions: Record<string, { x: number; y: number }>;
  /** Keyed by `EXPORT_TABLES[].key`. */
  tables: Record<string, ExportRow[]>;
}

export const EXPORT_FORMAT = "starline-export";
export const FOLDER_FORMAT = "starline-folder";
/** Version of the interchange format — independent of the DB schema (spec §4.5.4). */
export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportApp {
  name: string;
  version: string;
}

/** The canonical JSON interchange document (spec §4.5.1). */
export interface ExportDocument extends Record<string, unknown> {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: number;
  app: ExportApp;
  project: ExportRow;
  series: ExportRow | null;
  graphPositions: Record<string, { x: number; y: number }>;
}
