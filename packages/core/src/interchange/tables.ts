/**
 * Table-shaped exports (spec §4.5.1): `characters.csv`, `scenes.csv` (with POV and location
 * resolved to names), `relationships.csv`, `lore.csv`. These are for spreadsheets, not for the
 * round-trip gate — the frontmatter files in the Markdown folder are the authoritative copy.
 */
import { pmDocToPlainText } from "../richtext";
import { toCsv } from "./csv";
import type { FileMap } from "./markdown";
import type { ExportRow, ProjectExport } from "./types";

function plain(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return pmDocToPlainText(value as Parameters<typeof pmDocToPlainText>[0]);
}

function csvList(value: unknown): string {
  if (Array.isArray(value)) return value.join(" | ");
  if (typeof value === "string") return value;
  return "";
}

export function buildCsvTables(data: ProjectExport): FileMap {
  const tables = data.tables;
  const characters = tables.characters ?? [];
  const scenes = tables.scenes ?? [];
  const chapters = tables.chapters ?? [];
  const lore = tables.loreEntries ?? [];
  const relationships = tables.relationships ?? [];
  const plotlines = tables.plotlines ?? [];
  const categories = tables.loreCategories ?? [];
  const tags = tables.tags ?? [];
  const entityTags = tables.entityTags ?? [];
  const fieldValues = tables.fieldValues ?? [];
  const fieldDefs = tables.fieldDefs ?? [];

  const nameById = new Map(characters.map((row) => [String(row.id), String(row.name ?? "")]));
  const loreNameById = new Map(lore.map((row) => [String(row.id), String(row.name ?? "")]));
  const chapterById = new Map(chapters.map((row) => [String(row.id), String(row.title ?? "")]));
  const categoryById = new Map(categories.map((row) => [String(row.id), String(row.name ?? "")]));
  const plotlineById = new Map(plotlines.map((row) => [String(row.id), String(row.name ?? "")]));
  const tagById = new Map(tags.map((row) => [String(row.id), String(row.name ?? "")]));
  const defById = new Map(fieldDefs.map((row) => [String(row.id), String(row.label ?? "")]));

  const tagsFor = (entityType: string, entityId: string): string =>
    entityTags
      .filter((row) => row.entity_type === entityType && row.entity_id === entityId)
      .map((row) => tagById.get(String(row.tag_id)) ?? "")
      .filter((name) => name.length > 0)
      .join(" | ");

  const fieldsFor = (ownerType: string, ownerId: string): string =>
    fieldValues
      .filter((row) => row.owner_type === ownerType && row.owner_id === ownerId)
      .map((row) => {
        const label = defById.get(String(row.def_id)) ?? "";
        const value = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
        return label.length > 0 ? `${label}: ${value}` : value;
      })
      .join(" | ");

  const files: FileMap = {};

  files["characters.csv"] = toCsv(
    [
      "id",
      "name",
      "aliases",
      "role",
      "pronouns",
      "age",
      "occupation",
      "oneLine",
      "motivation",
      "goal",
      "conflict",
      "epiphany",
      "want",
      "need",
      "arcType",
      "flaws",
      "strengths",
      "fears",
      "values",
      "tags",
      "fields",
    ],
    characters.map((row) => [
      row.id,
      row.name,
      csvList(row.aliases),
      row.role,
      row.pronouns,
      row.age,
      row.occupation,
      row.one_line,
      row.motivation,
      row.goal,
      row.conflict,
      row.epiphany,
      row.want,
      row.need,
      row.arc_type,
      csvList(row.flaws),
      csvList(row.strengths),
      csvList(row.fears),
      csvList(row.values),
      tagsFor("character", String(row.id)),
      fieldsFor("character", String(row.id)),
    ]),
  );

  files["scenes.csv"] = toCsv(
    [
      "id",
      "order",
      "chapter",
      "title",
      "pov",
      "location",
      "status",
      "outcome",
      "objective",
      "obstacle",
      "emotionStart",
      "emotionEnd",
      "timeOfDay",
      "storyTime",
      "storyTimeLabel",
      "targetWords",
      "bodyWords",
      "synopsis",
      "tags",
      "fields",
    ],
    scenes.map((row, index) => [
      row.id,
      index + 1,
      typeof row.chapter_id === "string" ? (chapterById.get(row.chapter_id) ?? "") : "",
      row.title,
      typeof row.pov_character_id === "string" ? (nameById.get(row.pov_character_id) ?? "") : "",
      typeof row.location_id === "string" ? (loreNameById.get(row.location_id) ?? "") : "",
      row.status,
      row.outcome,
      row.objective,
      row.obstacle,
      row.emotion_start,
      row.emotion_end,
      row.time_of_day,
      row.story_time,
      row.story_time_label,
      row.target_word_count,
      row.body_word_count,
      plain(row.synopsis_json).trim() || String(row.synopsis_text ?? ""),
      tagsFor("scene", String(row.id)),
      fieldsFor("scene", String(row.id)),
    ]),
  );

  files["relationships.csv"] = toCsv(
    [
      "id",
      "source",
      "target",
      "kind",
      "customLabel",
      "directed",
      "sentiment",
      "secret",
      "group",
      "startsAtScene",
      "endsAtScene",
      "notes",
    ],
    relationships.map((row) => [
      row.id,
      typeof row.source_id === "string" ? (nameById.get(row.source_id) ?? "") : "",
      typeof row.target_id === "string" ? (nameById.get(row.target_id) ?? "") : "",
      row.kind,
      row.custom_label,
      row.directed,
      row.sentiment,
      row.secret,
      row.group_id,
      row.starts_at_scene_id,
      row.ends_at_scene_id,
      plain(row.notes_json).trim() || String(row.notes_text ?? ""),
    ]),
  );

  files["lore.csv"] = toCsv(
    ["id", "name", "kind", "category", "parent", "aliases", "summary", "body", "tags", "fields"],
    lore.map((row) => [
      row.id,
      row.name,
      row.kind === "custom" ? row.custom_kind_label : row.kind,
      typeof row.category_id === "string" ? (categoryById.get(row.category_id) ?? "") : "",
      typeof row.parent_entry_id === "string" ? (loreNameById.get(row.parent_entry_id) ?? "") : "",
      csvList(row.aliases),
      row.summary,
      plain(row.body_json).trim() || String(row.body_text ?? ""),
      tagsFor("lore", String(row.id)),
      fieldsFor("lore", String(row.id)),
    ]),
  );

  files["timeline.csv"] = toCsv(
    [
      "id",
      "title",
      "storyTime",
      "storyTimeEnd",
      "label",
      "lane",
      "character",
      "plotline",
      "scene",
      "description",
    ],
    (tables.timelineEvents ?? []).map((row) => [
      row.id,
      row.title,
      row.story_time,
      row.story_time_end,
      row.story_time_label,
      row.lane,
      typeof row.character_id === "string" ? (nameById.get(row.character_id) ?? "") : "",
      typeof row.plotline_id === "string" ? (plotlineById.get(row.plotline_id) ?? "") : "",
      typeof row.scene_id === "string" ? String(row.scene_id) : "",
      String(row.description_text ?? ""),
    ]),
  );

  files["notes.csv"] = toCsv(
    ["id", "title", "kind", "status", "pinned", "body"],
    (tables.notes ?? []).map((row) => [
      row.id,
      row.title,
      row.kind,
      row.status,
      row.pinned,
      plain(row.body_json).trim() || String(row.body_text ?? ""),
    ]),
  );

  return files;
}

/** Table exports are delivered as one zip so a phone gets a single shareable file. */
export function csvTableNames(): string[] {
  return [
    "characters.csv",
    "scenes.csv",
    "relationships.csv",
    "lore.csv",
    "timeline.csv",
    "notes.csv",
  ];
}

export type { ExportRow };
