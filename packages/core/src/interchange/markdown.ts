/**
 * The Markdown folder (spec §5.4.2): `*.starline.zip` — the format a writer opens in Obsidian.
 *
 * Lossless for every content column the JSON format carries, because the frontmatter of each file
 * holds the row exactly as the database has it (JSON columns as inline JSON, which is valid YAML)
 * while the body holds the same thing rendered for a human. Timestamps are the one deliberate
 * exception: the folder has no `created_at`/`updated_at`, so a hand-edited file can be re-imported
 * without inventing history — which is also what makes `folder → import → folder` identical.
 */

import { attachmentExtension } from "../attachments/types";
import { extractMentions } from "../lore/mentions";
import { BLOCK_TYPES, type PMDoc, type PMNode, pmDocToPlainText } from "../richtext";
import { cell, parseCsv, toCsv } from "./csv";
import { numberPrefix, slugify, uniqueSlugs } from "./slug";
import { EXPORT_TABLES, type ExportRow, type ProjectExport } from "./types";

export const FOLDER_MANIFEST = "starline.json";
export const PROJECT_MARKDOWN = "project.md";

/** Columns the folder deliberately does not carry (see the header comment). */
export const FOLDER_SKIPPED_COLUMNS = new Set(["created_at", "updated_at", "deleted_at"]);

/** Rich-text columns rendered as a labelled section in the body. */
const BODY_SECTIONS: Record<string, Array<[string, string]>> = {
  character: [
    ["one_paragraph_json", "One paragraph"],
    ["storyline_json", "Storyline"],
    ["internal_conflict_json", "Internal conflict"],
    ["external_conflict_json", "External conflict"],
    ["ghost_json", "Ghost"],
    ["voice_notes_json", "Voice notes"],
    ["appearance_json", "Appearance"],
    ["backstory_json", "Backstory"],
    ["bible_json", "Bible"],
  ],
  scene: [
    ["synopsis_json", "Synopsis"],
    ["body_json", "Draft"],
  ],
  lore_entry: [["body_json", "Notes"]],
  idea_note: [["body_json", "Note"]],
  plotline: [["description_json", "Description"]],
  timeline_event: [["description_json", "Description"]],
  chapter: [["summary_json", "Summary"]],
  part: [["summary_json", "Summary"]],
  relationship_group: [],
  character_relationship: [["notes_json", "Notes"]],
};

// ── YAML subset ──────────────────────────────────────────────────────────────────────────────

const PLAIN_SAFE = /^[A-Za-z0-9_][A-Za-z0-9 _.\-/@()]*$/;

/** A scalar or a JSON value, emitted so that YAML 1.2 and our own parser agree on it. */
export function yamlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (value.length === 0) return '""';
    return PLAIN_SAFE.test(value) && !value.endsWith(" ") ? value : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

export function parseYamlValue(raw: string): unknown {
  const text = raw.trim();
  if (text === "" || text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.startsWith('"') || text.startsWith("[") || text.startsWith("{")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

export function emitFrontmatter(
  row: ExportRow,
  order: readonly string[],
  extra: Record<string, unknown> = {},
): string {
  const lines = ["---"];
  for (const key of order) {
    if (FOLDER_SKIPPED_COLUMNS.has(key)) continue;
    if (!(key in row)) continue;
    lines.push(`${key}: ${yamlValue(row[key])}`);
  }
  for (const [key, value] of Object.entries(extra)) {
    lines.push(`${key}: ${yamlValue(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function parseFrontmatter(text: string): { data: ExportRow; body: string } {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const head = text.slice(4, end);
  const bodyStart = text.indexOf("\n", end + 1);
  const body = bodyStart === -1 ? "" : text.slice(bodyStart + 1);
  const data: ExportRow = {};
  for (const line of head.split("\n")) {
    const match = /^([A-Za-z0-9_]+):\s?(.*)$/.exec(line);
    if (match === null) continue;
    data[match[1] as string] = parseYamlValue(match[2] ?? "");
  }
  return { data, body };
}

/** `# Heading` sections of a body, so a hand-edited file can fill a field the frontmatter lost. */
export function bodySections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let current = "";
  const buffer: string[] = [];
  const flush = () => {
    if (current.length > 0) sections[current] = buffer.join("\n").trim();
    buffer.length = 0;
  };
  for (const line of body.split("\n")) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading !== null) {
      flush();
      current = (heading[1] ?? "").trim().toLowerCase();
      continue;
    }
    if (current.length > 0) buffer.push(line);
  }
  flush();
  return sections;
}

// ── Folder building ──────────────────────────────────────────────────────────────────────────

export type FileMap = Record<string, string>;

function textOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return pmDocToPlainText(value as PMDoc);
}

/**
 * A rich-text column as Markdown with mention chips as `[[label]]` wiki-links (S34, spec
 * 4.5.1) — the file stays readable in an Obsidian vault, and the frontmatter's `mentions`
 * array carries the ids the re-import resolves against.
 */
function markdownOf(doc: unknown): string {
  if (doc === null || doc === undefined || typeof doc !== "object") return "";
  const parts: string[] = [];
  const walk = (nodes: PMNode[] | undefined): void => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type === "text" && node.text) {
        parts.push(node.text);
      } else if (node.type === "mention" && node.attrs?.label != null) {
        parts.push(`[[${String(node.attrs.label)}]]`);
      } else if (node.content) {
        walk(node.content);
        if (BLOCK_TYPES.has(node.type)) parts.push("\n");
      }
    }
  };
  walk((doc as PMDoc).content);
  return parts.join("");
}

function bodyFor(table: string, row: ExportRow): string {
  const sections = BODY_SECTIONS[table] ?? [];
  if (sections.length === 0) return "";
  const parts: string[] = [];
  for (const [column, label] of sections) {
    const text = markdownOf(row[column]);
    if (text.trim().length === 0) continue;
    parts.push(`## ${label}\n\n${text.trim()}`);
  }
  return parts.join("\n\n");
}

/** Mention chips of one rich-text column, as `{field, targetType, targetId}` rows. */
function mentionsOf(table: string, row: ExportRow): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const [column, label] of BODY_SECTIONS[table] ?? []) {
    const doc = row[column];
    if (doc === null || doc === undefined || typeof doc !== "object") continue;
    for (const mention of extractMentions(doc as PMDoc)) {
      out.push({
        field: column.replace(/_json$/, ""),
        section: label,
        targetType: mention.targetType,
        targetId: mention.targetId,
      });
    }
  }
  return out;
}

function joinPath(...parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("/");
}

/**
 * The whole folder as `path → text`. Deterministic: same project, same bytes.
 */
export function buildMarkdownFolder(
  data: ProjectExport,
  options: { exportedAt: number; folderName?: string },
): FileMap {
  const files: FileMap = {};
  const tables = data.tables;
  const project = data.project;
  const title = String(project.title ?? "Untitled");
  const projectId = String(project.id ?? "");
  const root = options.folderName !== undefined ? options.folderName : "";

  const characters = tables.characters ?? [];
  const scenes = tables.scenes ?? [];
  const chapters = tables.chapters ?? [];
  const parts = tables.parts ?? [];
  const lore = tables.loreEntries ?? [];
  const loreCategories = tables.loreCategories ?? [];
  const notes = tables.notes ?? [];
  const relationships = tables.relationships ?? [];
  const timeline = tables.timelineEvents ?? [];
  const plotlines = tables.plotlines ?? [];

  const characterNames = new Map(characters.map((row) => [String(row.id), String(row.name)]));
  const loreNames = new Map(lore.map((row) => [String(row.id), String(row.name)]));

  // starline.json — the machine-readable summary the folder is identified by.
  files[joinPath(root, FOLDER_MANIFEST)] = `${JSON.stringify(
    {
      format: "starline-folder",
      schemaVersion: 1,
      projectId,
      exportedAt: options.exportedAt,
      app: { name: "StarLine", version: "0.11.0" },
    },
    null,
    2,
  )}\n`;

  // project.md
  files[joinPath(root, PROJECT_MARKDOWN)] = [
    emitFrontmatter(project, Object.keys(project)),
    "",
    `# ${title}`,
    "",
    String(project.logline ?? "").trim(),
    "",
    String(project.description_text ?? "").trim(),
    "",
  ].join("\n");

  // snowflake/NN-*.md — one file per completed or in-progress step.
  const STEP_SLUGS: Record<number, string> = {
    1: "one-sentence",
    2: "one-paragraph",
    3: "character-summaries",
    4: "expanded-summary",
    5: "character-descriptions",
    6: "four-page-synopsis",
    7: "character-bibles",
    8: "scene-list",
    9: "scene-narratives",
  };
  for (const step of tables.snowflakeSteps ?? []) {
    const number = Number(step.step ?? 0);
    const slug = STEP_SLUGS[number] ?? `step-${number}`;
    files[joinPath(root, "snowflake", `${numberPrefix(number)}-${slug}.md`)] = [
      emitFrontmatter(step, Object.keys(step)),
      "",
      `# Step ${number} — ${slug.replace(/-/g, " ")}`,
      "",
    ].join("\n");
  }

  // characters/<slug>.md
  const characterSlugs = uniqueSlugs(characters.map((row) => String(row.name ?? "")));
  characters.forEach((row, index) => {
    const mentions = mentionsOf("character", row);
    files[joinPath(root, "characters", `${characterSlugs[index]}.md`)] = [
      emitFrontmatter(row, Object.keys(row), mentions.length > 0 ? { mentions } : {}),
      "",
      `# ${String(row.name ?? "")}`,
      "",
      String(row.one_line ?? "").trim(),
      "",
      bodyFor("character", row),
      "",
    ]
      .filter((part, position) => !(position === 1 && part === ""))
      .join("\n");
  });

  // relationships.csv (ids, so a re-import matches rows even after a rename)
  files[joinPath(root, "relationships.csv")] = toCsv(
    [
      "sourceId",
      "targetId",
      "kind",
      "customLabel",
      "directed",
      "sentiment",
      "groupId",
      "startsAtSceneId",
      "endsAtSceneId",
      "secret",
      "notes",
    ],
    relationships.map((row) => [
      row.source_id,
      row.target_id,
      row.kind,
      row.custom_label,
      row.directed,
      row.sentiment,
      row.group_id,
      row.starts_at_scene_id,
      row.ends_at_scene_id,
      row.secret,
      row.notes_text,
    ]),
  );

  // outline/part-NN-<slug>/chapter-NN-<slug>/scene-NN-<slug>.md
  const chapterById = new Map(chapters.map((row) => [String(row.id), row]));
  const partSlugs = uniqueSlugs(parts.map((row) => String(row.title ?? "part")));
  const partById = new Map(parts.map((row, index) => [String(row.id), partSlugs[index] as string]));
  const chapterSlugs = uniqueSlugs(chapters.map((row) => String(row.title ?? "chapter")));
  const chapterPathById = new Map<string, string>();
  chapters.forEach((row, index) => {
    const partId = row.part_id;
    const parent =
      typeof partId === "string" && partById.has(partId)
        ? `part-${numberPrefix(parts.findIndex((part) => part.id === partId) + 1)}-${partById.get(partId)}`
        : "no-part";
    chapterPathById.set(
      String(row.id),
      joinPath(
        root,
        "outline",
        parent,
        `chapter-${numberPrefix(index + 1)}-${chapterSlugs[index]}`,
      ),
    );
  });
  // The outline folders carry the part and chapter rows themselves (`part.md`, `chapter.md`),
  // otherwise a re-import would keep the scenes but lose the structure they hang from.
  parts.forEach((row, index) => {
    const path = joinPath(
      root,
      "outline",
      `part-${numberPrefix(index + 1)}-${partSlugs[index]}`,
      "part.md",
    );
    files[path] = [
      emitFrontmatter(row, Object.keys(row)),
      "",
      `# ${String(row.title ?? "")}`,
      "",
      String(row.summary_text ?? "").trim(),
      "",
    ].join("\n");
  });
  chapters.forEach((row) => {
    const parent = chapterPathById.get(String(row.id));
    if (parent === undefined) return;
    files[joinPath(parent, "chapter.md")] = [
      emitFrontmatter(row, Object.keys(row)),
      "",
      `# ${String(row.title ?? "")}`,
      "",
      String(row.summary_text ?? "").trim(),
      "",
    ].join("\n");
  });

  const scenesByChapter = new Map<string, ExportRow[]>();
  for (const scene of scenes) {
    const chapterId = typeof scene.chapter_id === "string" ? scene.chapter_id : "";
    const list = scenesByChapter.get(chapterId) ?? [];
    list.push(scene);
    scenesByChapter.set(chapterId, list);
  }
  const sceneSlugsAll = uniqueSlugs(scenes.map((row) => String(row.title ?? "scene")));
  const sceneIndexById = new Map(scenes.map((row, index) => [String(row.id), index]));
  const sceneIdToPath = new Map<string, string>();
  let sceneNumber = 0;
  for (const [chapterId, list] of scenesByChapter) {
    const parent =
      chapterId.length > 0
        ? (chapterPathById.get(chapterId) ?? joinPath(root, "outline"))
        : joinPath(root, "outline");
    for (const scene of list) {
      sceneNumber += 1;
      const slug =
        sceneSlugsAll[sceneIndexById.get(String(scene.id)) ?? -1] ??
        slugify(String(scene.title ?? "scene"));
      const path = joinPath(parent, `scene-${numberPrefix(sceneNumber)}-${slug}.md`);
      sceneIdToPath.set(String(scene.id), path);
      const mentions = mentionsOf("scene", scene);
      const pov =
        typeof scene.pov_character_id === "string"
          ? (characterNames.get(scene.pov_character_id) ?? "")
          : "";
      const location =
        typeof scene.location_id === "string" ? (loreNames.get(scene.location_id) ?? "") : "";
      files[path] = [
        emitFrontmatter(scene, Object.keys(scene), mentions.length > 0 ? { mentions } : {}),
        "",
        `# ${String(scene.title ?? "")}`,
        "",
        pov.length > 0 ? `- **POV:** ${pov}` : "",
        location.length > 0 ? `- **Location:** ${location}` : "",
        chapterId.length > 0
          ? `- **Chapter:** ${String(chapterById.get(chapterId)?.title ?? "")}`
          : "- **Chapter:** —",
        "",
        bodyFor("scene", scene),
        "",
      ]
        .filter((part) => part !== "")
        .join("\n");
    }
  }

  // lore/<category-path>/<slug>.md
  const categoryById = new Map(loreCategories.map((row) => [String(row.id), row]));
  const categoryPath = (categoryId: string): string => {
    const chain: string[] = [];
    let current: string | undefined = categoryId;
    let guard = 0;
    while (current !== undefined && current.length > 0 && guard < 12) {
      const row = categoryById.get(current);
      if (row === undefined) break;
      chain.unshift(slugify(String(row.name ?? "category")));
      current = typeof row.parent_id === "string" ? row.parent_id : undefined;
      guard += 1;
    }
    return chain.join("/");
  };
  const loreSlugs = uniqueSlugs(lore.map((row) => String(row.name ?? "entry")));
  lore.forEach((row, index) => {
    const categoryId = typeof row.category_id === "string" ? row.category_id : "";
    const mentions = mentionsOf("lore_entry", row);
    files[joinPath(root, "lore", categoryPath(categoryId), `${loreSlugs[index]}.md`)] = [
      emitFrontmatter(row, Object.keys(row), mentions.length > 0 ? { mentions } : {}),
      "",
      `# ${String(row.name ?? "")}`,
      "",
      String(row.summary ?? "").trim(),
      "",
      bodyFor("lore_entry", row),
      "",
    ]
      .filter((part) => part !== "")
      .join("\n");
  });

  // notes/<slug>.md
  const noteSlugs = uniqueSlugs(notes.map((row) => String(row.title ?? "note")));
  notes.forEach((row, index) => {
    const mentions = mentionsOf("idea_note", row);
    files[joinPath(root, "notes", `${noteSlugs[index]}.md`)] = [
      emitFrontmatter(row, Object.keys(row), mentions.length > 0 ? { mentions } : {}),
      "",
      `# ${String(row.title ?? "")}`,
      "",
      bodyFor("idea_note", row),
      "",
    ]
      .filter((part) => part !== "")
      .join("\n");
  });

  // timeline/<slug>.md and plotlines/<slug>.md — the authoritative copies; the CSVs below are
  // the table-shaped views a spreadsheet user opens.
  const eventSlugs = uniqueSlugs(timeline.map((row) => String(row.title ?? "event")));
  timeline.forEach((row, index) => {
    const mentions = mentionsOf("timeline_event", row);
    files[joinPath(root, "timeline", `${numberPrefix(index + 1)}-${eventSlugs[index]}.md`)] = [
      emitFrontmatter(row, Object.keys(row), mentions.length > 0 ? { mentions } : {}),
      "",
      `# ${String(row.title ?? "")}`,
      "",
      String(row.description_text ?? "").trim(),
      "",
    ].join("\n");
  });
  const plotlineSlugs = uniqueSlugs(plotlines.map((row) => String(row.name ?? "plotline")));
  plotlines.forEach((row, index) => {
    const mentions = mentionsOf("plotline", row);
    files[joinPath(root, "plotlines", `${numberPrefix(index + 1)}-${plotlineSlugs[index]}.md`)] = [
      emitFrontmatter(row, Object.keys(row), mentions.length > 0 ? { mentions } : {}),
      "",
      `# ${String(row.name ?? "")}`,
      "",
      String(row.description_text ?? "").trim(),
      "",
    ].join("\n");
  });

  // tags/fields/meta sidecars.
  files[joinPath(root, "timeline.csv")] = toCsv(
    [
      "id",
      "title",
      "storyTime",
      "storyTimeEnd",
      "label",
      "lane",
      "characterId",
      "plotlineId",
      "sceneId",
      "loreEntryId",
      "color",
      "description",
    ],
    timeline.map((row) => [
      row.id,
      row.title,
      row.story_time,
      row.story_time_end,
      row.story_time_label,
      row.lane,
      row.character_id,
      row.plotline_id,
      row.scene_id,
      row.lore_entry_id,
      row.color,
      row.description_text,
    ]),
  );
  files[joinPath(root, "plotlines.csv")] = toCsv(
    ["id", "name", "kind", "color", "characterId", "orderKey", "description"],
    plotlines.map((row) => [
      row.id,
      row.name,
      row.kind,
      row.color,
      row.character_id,
      row.order_key,
      row.description_text,
    ]),
  );
  files[joinPath(root, "tags.json")] = `${JSON.stringify(
    { tags: tables.tags ?? [], entityTags: tables.entityTags ?? [] },
    null,
    2,
  )}\n`;
  files[joinPath(root, "custom-fields.json")] = `${JSON.stringify(
    { defs: tables.fieldDefs ?? [], values: tables.fieldValues ?? [] },
    null,
    2,
  )}\n`;
  files[joinPath(root, "meta.json")] = `${JSON.stringify(
    {
      relationshipGroups: tables.relationshipGroups ?? [],
      sceneCharacters: tables.sceneCharacters ?? [],
      sceneLore: tables.sceneLore ?? [],
      scenePlotlines: tables.scenePlotlines ?? [],
      entityLinks: tables.entityLinks ?? [],
      attachments: tables.attachments ?? [],
      characterGallery: tables.characterGallery ?? [],
      graphPositions: data.graphPositions,
      series: data.series,
    },
    null,
    2,
  )}\n`;
  return files;
}

/**
 * Attachment bytes as archive entries: `attachments/<sha256>.<ext>`. The name is the hash, so the
 * same picture in two libraries lands on the same path and the archive stays deterministic.
 */
export function buildAttachmentFiles(
  data: ProjectExport,
  options: { folderName?: string } = {},
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const root = options.folderName !== undefined ? options.folderName : "";
  const byteMap = data.attachmentData ?? {};
  for (const row of data.tables.attachments ?? []) {
    const id = typeof row.id === "string" ? row.id : null;
    const sha = typeof row.sha256 === "string" ? row.sha256 : null;
    if (id === null || sha === null) continue;
    const bytes = byteMap[id];
    if (bytes === undefined) continue;
    const extension = attachmentExtension(String(row.file_name ?? ""), String(row.mime_type ?? ""));
    files[joinPath(root, "attachments", `${sha}.${extension}`)] = bytes;
  }
  return files;
}

/** Writes the folder back into an export payload; the frontmatter is authoritative. */
export function parseMarkdownFolder(
  files: FileMap,
  /** Raw archive entries keyed by path — `attachments/<sha256>.<ext>` files come back as bytes. */
  binary: Record<string, Uint8Array> = {},
): { data: ProjectExport; issues: string[] } {
  const issues: string[] = [];
  const tables: Record<string, ExportRow[]> = {};
  for (const spec of EXPORT_TABLES) tables[spec.key] = [];

  const readFile = (path: string, text: string): ExportRow | null => {
    const { data } = parseFrontmatter(text);
    if (Object.keys(data).length === 0) {
      issues.push(`${path}: no frontmatter — skipped`);
      return null;
    }
    if (typeof data.id !== "string" || (data.id as string).length === 0) {
      issues.push(`${path}: frontmatter has no id — skipped`);
      return null;
    }
    return data;
  };

  let project: ExportRow | null = null;
  let graphPositions: Record<string, { x: number; y: number }> = {};
  let series: ExportRow | null = null;

  for (const [path, text] of Object.entries(files)) {
    const base = path.split("/").pop() ?? path;
    if (base === PROJECT_MARKDOWN) {
      project = readFile(path, text);
      continue;
    }
    if (base === FOLDER_MANIFEST) continue;
    const segments = path.split("/");
    if (segments.includes("snowflake")) {
      const row = readFile(path, text);
      if (row !== null) tables.snowflakeSteps?.push(row);
      continue;
    }
    if (segments.includes("characters")) {
      const row = readFile(path, text);
      if (row !== null) tables.characters?.push(row);
      continue;
    }
    if (segments.includes("lore")) {
      const row = readFile(path, text);
      if (row !== null) tables.loreEntries?.push(row);
      continue;
    }
    if (segments.includes("notes")) {
      const row = readFile(path, text);
      if (row !== null) tables.notes?.push(row);
      continue;
    }
    if (segments.includes("timeline") && base !== "timeline.csv") {
      const row = readFile(path, text);
      if (row !== null) tables.timelineEvents?.push(row);
      continue;
    }
    if (segments.includes("plotlines") && base !== "plotlines.csv") {
      const row = readFile(path, text);
      if (row !== null) tables.plotlines?.push(row);
      continue;
    }
    if (segments.includes("outline")) {
      const row = readFile(path, text);
      if (row === null) continue;
      if (base === "part.md") tables.parts?.push(row);
      else if (base === "chapter.md") tables.chapters?.push(row);
      else tables.scenes?.push(row);
      continue;
    }
    if (base === "meta.json") {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        tables.relationshipGroups = (parsed.relationshipGroups as ExportRow[]) ?? [];
        tables.sceneCharacters = (parsed.sceneCharacters as ExportRow[]) ?? [];
        tables.sceneLore = (parsed.sceneLore as ExportRow[]) ?? [];
        tables.scenePlotlines = (parsed.scenePlotlines as ExportRow[]) ?? [];
        tables.entityLinks = (parsed.entityLinks as ExportRow[]) ?? [];
        tables.attachments = (parsed.attachments as ExportRow[]) ?? [];
        tables.characterGallery = (parsed.characterGallery as ExportRow[]) ?? [];
        graphPositions = (parsed.graphPositions as Record<string, { x: number; y: number }>) ?? {};
        series = (parsed.series as ExportRow | null) ?? null;
      } catch {
        issues.push("meta.json: not valid JSON");
      }
      continue;
    }
    if (base === "tags.json") {
      try {
        const parsed = JSON.parse(text) as { tags?: ExportRow[]; entityTags?: ExportRow[] };
        tables.tags = parsed.tags ?? [];
        tables.entityTags = parsed.entityTags ?? [];
      } catch {
        issues.push("tags.json: not valid JSON");
      }
      continue;
    }
    if (base === "custom-fields.json") {
      try {
        const parsed = JSON.parse(text) as { defs?: ExportRow[]; values?: ExportRow[] };
        tables.fieldDefs = parsed.defs ?? [];
        tables.fieldValues = parsed.values ?? [];
      } catch {
        issues.push("custom-fields.json: not valid JSON");
      }
      continue;
    }
    if (base === "relationships.csv") {
      const parsed = parseCsv(text);
      const at = (name: string) => parsed.header.indexOf(name);
      const sourceIdx = at("sourceId");
      const targetIdx = at("targetId");
      const kindIdx = at("kind");
      const labelIdx = at("customLabel");
      const directedIdx = at("directed");
      const sentimentIdx = at("sentiment");
      const groupIdx = at("groupId");
      const startIdx = at("startsAtSceneId");
      const endIdx = at("endsAtSceneId");
      const secretIdx = at("secret");
      const notesIdx = at("notes");
      for (const row of parsed.rows) {
        const id = `rel-${cell(row, sourceIdx)}-${cell(row, targetIdx)}-${cell(row, kindIdx)}`;
        tables.relationships?.push({
          id,
          source_id: cell(row, sourceIdx),
          target_id: cell(row, targetIdx),
          kind: cell(row, kindIdx),
          custom_label: cell(row, labelIdx),
          directed: cell(row, directedIdx) === "1" ? 1 : 0,
          sentiment: Number(cell(row, sentimentIdx) || 0),
          group_id: cell(row, groupIdx) || null,
          starts_at_scene_id: cell(row, startIdx) || null,
          ends_at_scene_id: cell(row, endIdx) || null,
          secret: cell(row, secretIdx) === "1" ? 1 : 0,
          notes_text: cell(row, notesIdx),
        });
      }
      continue;
    }
    if (base === "timeline.csv" || base === "plotlines.csv") continue; // not round-tripped (sidecars)
  }

  if (project === null) {
    return {
      data: { project: {}, series: null, graphPositions: {}, tables },
      issues: [...issues, "project.md is missing or unreadable"],
    };
  }

  // Match attachment rows to their archive entries by hash — the same key the exporter used.
  const attachmentData: Record<string, Uint8Array> = {};
  for (const row of tables.attachments ?? []) {
    const id = typeof row.id === "string" ? row.id : null;
    const sha = typeof row.sha256 === "string" ? row.sha256 : null;
    if (id === null || sha === null) continue;
    const match = Object.entries(binary).find(([path]) => {
      const base = path.split("/").pop() ?? path;
      return path.includes("attachments/") && base.startsWith(`${sha}.`);
    });
    if (match === undefined) {
      issues.push(`attachments/${sha}: file missing from the archive — imported without bytes`);
      continue;
    }
    attachmentData[id] = match[1];
  }

  const data: ProjectExport = { project, series, graphPositions, tables };
  if (Object.keys(attachmentData).length > 0) data.attachmentData = attachmentData;
  return { data, issues };
}
