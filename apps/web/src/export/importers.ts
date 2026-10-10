/**
 * The two in-app importers (spec §4.5.2): a CSV with column mapping and a dry run, and a
 * manuscript/text split into chapters and scenes. Both write through the ordinary commands, so
 * every imported row is undoable and shows up in the change bus like anything else.
 */
import {
  type Command,
  cell,
  columnIndex,
  createChapter,
  createCharacter,
  createScene,
  createScenesFromList,
  createTag,
  listTags,
  parseCsv,
  richTextFromPlain,
  setSceneBody,
  toggleEntityTag,
  type UUID,
  updateCharacter,
  updateScene,
} from "@starline/core";

import { runCommand } from "../data";
import type { LibrarySession } from "../session";

export type ImportTarget = "character" | "scene";

export interface ColumnMapping {
  /** Field name → CSV header name (empty = unused). */
  [field: string]: string;
}

/** The fields the CSV importer understands, in the order the mapping UI shows them. */
export const CHARACTER_FIELDS = [
  "name",
  "role",
  "oneLine",
  "pronouns",
  "age",
  "occupation",
  "motivation",
  "goal",
  "conflict",
  "epiphany",
  "aliases",
  "tags",
] as const;

export const SCENE_FIELDS = [
  "title",
  "pov",
  "oneLine",
  "estWords",
  "chapter",
  "status",
  "location",
] as const;

const CHARACTER_ALIASES: Record<string, string[]> = {
  name: ["name", "character", "figur", "имя", "персонаж"],
  role: ["role", "rolle", "роль"],
  oneLine: ["oneline", "one line", "one-liner", "description", "описание"],
  pronouns: ["pronouns", "pronomen", "займенники"],
  age: ["age", "alter", "вік"],
  occupation: ["occupation", "job", "beruf", "професія"],
  motivation: ["motivation", "мотивация", "мотивація"],
  goal: ["goal", "ziel", "мета"],
  conflict: ["conflict", "konflikt", "конфлікт"],
  epiphany: ["epiphany", "epiphanie", "осяяння"],
  aliases: ["aliases", "alias", "псевдонім"],
  tags: ["tags", "tag", "теги"],
};

const SCENE_ALIASES: Record<string, string[]> = {
  title: ["title", "scene", "szene", "назва"],
  pov: ["pov", "viewpoint", "perspektive", "точка зору"],
  oneLine: ["oneline", "one line", "summary", "synopsis", "опис"],
  estWords: ["words", "estwords", "estimate", "wörter", "слова"],
  chapter: ["chapter", "kapitel", "розділ"],
  status: ["status", "state", "стан"],
  location: ["location", "ort", "місце"],
};

const ROLE_VALUES = new Set([
  "protagonist",
  "antagonist",
  "major",
  "supporting",
  "minor",
  "mentioned",
]);

/** Suggests a mapping by looking at the header row; the writer can override every field. */
export function suggestMapping(header: readonly string[], target: ImportTarget): ColumnMapping {
  const aliases = target === "character" ? CHARACTER_ALIASES : SCENE_ALIASES;
  const fields = target === "character" ? CHARACTER_FIELDS : SCENE_FIELDS;
  const mapping: ColumnMapping = {};
  for (const field of fields) {
    const names = aliases[field] ?? [field.toLowerCase()];
    const index = columnIndex(
      header,
      names.map((name) => name.toLowerCase()),
    );
    mapping[field] = index >= 0 ? (header[index] ?? "") : "";
  }
  return mapping;
}

export interface DryRunRow {
  label: string;
  action: "create" | "skip";
  reason: string;
}

export interface DryRun {
  delimiter: string;
  header: string[];
  rows: DryRunRow[];
  toCreate: number;
  skipped: number;
}

/** Counts what an import would do without writing anything (spec §4.5.2 "dry-run summary"). */
export function dryRunCsv(text: string, target: ImportTarget, mapping: ColumnMapping): DryRun {
  const parsed = parseCsv(text);
  const at = (row: readonly string[], field: string): string => {
    const header = mapping[field] ?? "";
    if (header.length === 0) return "";
    return cell(row, parsed.header.indexOf(header));
  };
  const rows: DryRunRow[] = [];
  let toCreate = 0;
  let skipped = 0;
  for (const row of parsed.rows) {
    if (target === "character") {
      const name = at(row, "name");
      if (name.length === 0) {
        skipped += 1;
        rows.push({ label: row.join(" · ").slice(0, 60), action: "skip", reason: "no name" });
        continue;
      }
      toCreate += 1;
      rows.push({ label: name, action: "create", reason: "" });
    } else {
      const title = at(row, "title");
      const oneLine = at(row, "oneLine");
      if (title.length === 0 && oneLine.length === 0) {
        skipped += 1;
        rows.push({ label: row.join(" · ").slice(0, 60), action: "skip", reason: "no title" });
        continue;
      }
      toCreate += 1;
      rows.push({ label: title.length > 0 ? title : oneLine, action: "create", reason: "" });
    }
  }
  return { delimiter: parsed.delimiter, header: parsed.header, rows, toCreate, skipped };
}

export interface CsvImportResult {
  created: number;
  skipped: number;
  /** Scenes that were merged into an existing row (scene imports only). */
  updated: number;
}

export async function importCsv(
  session: LibrarySession,
  projectId: UUID,
  text: string,
  target: ImportTarget,
  mapping: ColumnMapping,
): Promise<CsvImportResult> {
  const parsed = parseCsv(text);
  const at = (row: readonly string[], field: string): string => {
    const header = mapping[field] ?? "";
    if (header.length === 0) return "";
    return cell(row, parsed.header.indexOf(header));
  };

  if (target === "character") {
    let created = 0;
    let skipped = 0;
    for (const row of parsed.rows) {
      const name = at(row, "name");
      if (name.length === 0) {
        skipped += 1;
        continue;
      }
      const roleRaw = at(row, "role").toLowerCase();
      const result = await runCommand(session.driver, createCharacter, {
        projectId,
        name,
        role: ROLE_VALUES.has(roleRaw) ? (roleRaw as "supporting") : "supporting",
      });
      const aliases = at(row, "aliases");
      const tags = at(row, "tags");
      const patch: Record<string, unknown> = {};
      for (const field of [
        "oneLine",
        "pronouns",
        "age",
        "occupation",
        "motivation",
        "goal",
        "conflict",
        "epiphany",
      ] as const) {
        const value = at(row, field);
        if (value.length > 0) patch[field] = value;
      }
      if (aliases.length > 0) {
        patch.aliases = aliases
          .split(/[|;]/)
          .map((alias) => alias.trim())
          .filter((alias) => alias.length > 0);
      }
      if (Object.keys(patch).length > 0) {
        await runCommand(session.driver, updateCharacter, {
          projectId,
          characterId: result.characterId,
          patch: patch as never,
        });
      }
      if (tags.length > 0) {
        await applyTags(session, projectId, "character", result.characterId, tags);
      }
      created += 1;
    }
    return { created, skipped, updated: 0 };
  }

  // Scenes: build the same line format the step-8 paste uses, so the merge-by-line logic
  // (zero duplicates on a re-import) applies to CSV imports as well.
  const lines: string[] = [];
  let skipped = 0;
  for (const row of parsed.rows) {
    const title = at(row, "title");
    const oneLine = at(row, "oneLine");
    if (title.length === 0 && oneLine.length === 0) {
      skipped += 1;
      continue;
    }
    const parts = [
      title.length > 0 ? title : oneLine,
      at(row, "pov"),
      oneLine,
      at(row, "estWords"),
      at(row, "chapter"),
    ];
    lines.push(parts.join("\t"));
  }
  if (lines.length === 0) return { created: 0, skipped, updated: 0 };
  const result = await runCommand(session.driver, createScenesFromList, {
    projectId,
    text: lines.join("\n"),
  });
  return { created: result.created, skipped: skipped + result.skipped, updated: result.updated };
}

/** Tags arrive as one cell (`a | b`) and are attached through the tag commands. */
async function applyTags(
  session: LibrarySession,
  projectId: UUID,
  entityType: "character" | "scene",
  entityId: UUID,
  cellText: string,
): Promise<void> {
  const names = cellText
    .split(/[|;]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) return;
  const existing = await listTags(session.driver, projectId);
  const byName = new Map(existing.map((tag) => [tag.name.toLowerCase(), tag.id]));
  for (const name of names) {
    let tagId = byName.get(name.toLowerCase());
    if (tagId === undefined) {
      const created = await runCommand(session.driver, createTag, { projectId, name });
      tagId = created.tagId;
      byName.set(name.toLowerCase(), tagId);
    }
    await runCommand(session.driver, toggleEntityTag, {
      projectId,
      entityType,
      entityId,
      tagId,
      attach: true,
    });
  }
}

// ── manuscript split ─────────────────────────────────────────────────────────────────────────

export interface SplitOptions {
  /** Markdown heading level that starts a chapter. */
  headingLevel: 1 | 2 | 3;
  /** What separates two scenes inside one chapter. */
  sceneBreak: "asterisks" | "blank" | "hash";
}

export interface SplitScene {
  title: string;
  body: string;
}

export interface SplitChapter {
  title: string;
  scenes: SplitScene[];
}

export interface SplitResult {
  chapters: SplitChapter[];
  sceneCount: number;
  wordCount: number;
}

const BREAK_PATTERNS: Record<SplitOptions["sceneBreak"], RegExp> = {
  asterisks: /^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/,
  hash: /^\s*#\s*$/,
  blank: /^\s*$/,
};

function looksLikeTitle(line: string): boolean {
  const text = line.trim();
  if (text.length === 0 || text.length > 80) return false;
  // A short line that is not a sentence (no closing punctuation) reads as a scene title.
  return !/[.!?…]["')\]]?$/.test(text) || text.split(/\s+/).length <= 6;
}

/** Splits a manuscript into chapters and scenes without writing anything. */
export function splitManuscript(text: string, options: SplitOptions): SplitResult {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const heading = new RegExp(`^#{${options.headingLevel}}\\s+(.*)$`);
  const chapters: SplitChapter[] = [];
  let current: SplitChapter = { title: "", scenes: [] };
  let buffer: string[] = [];

  const flushScene = () => {
    const body = buffer.join("\n").trim();
    buffer = [];
    if (body.length === 0) return;
    const bodyLines = body.split("\n");
    const first = bodyLines[0] ?? "";
    const rest = bodyLines.slice(1).join("\n").trim();
    const title = looksLikeTitle(first) && rest.length > 0 ? first.trim() : "";
    current.scenes.push({ title, body: title.length > 0 ? rest : body });
  };
  const flushChapter = () => {
    flushScene();
    if (current.scenes.length > 0 || current.title.length > 0) chapters.push(current);
    current = { title: "", scenes: [] };
  };

  for (const line of lines) {
    const match = heading.exec(line);
    if (match !== null) {
      flushChapter();
      current.title = (match[1] ?? "").trim();
      continue;
    }
    if (BREAK_PATTERNS[options.sceneBreak].test(line)) {
      if (options.sceneBreak === "blank") {
        // Two consecutive blanks separate scenes; a single blank is a paragraph break.
        if (buffer.length > 0 && (buffer.at(-1) ?? "").trim() === "") flushScene();
        else buffer.push("");
        continue;
      }
      flushScene();
      continue;
    }
    buffer.push(line);
  }
  flushChapter();

  const sceneCount = chapters.reduce((sum, chapter) => sum + chapter.scenes.length, 0);
  const wordCount = chapters.reduce(
    (sum, chapter) =>
      sum +
      chapter.scenes.reduce(
        (inner, scene) => inner + scene.body.split(/\s+/).filter(Boolean).length,
        0,
      ),
    0,
  );
  return { chapters, sceneCount, wordCount };
}

export interface ManuscriptImportResult {
  chapters: number;
  scenes: number;
}

/** Creates the chapters and scenes a split produced, through the ordinary commands. */
export async function importManuscript(
  session: LibrarySession,
  projectId: UUID,
  split: SplitResult,
): Promise<ManuscriptImportResult> {
  let chapters = 0;
  let scenes = 0;
  for (const chapter of split.chapters) {
    let chapterId: UUID | null = null;
    if (chapter.title.length > 0) {
      const created = await runCommand(session.driver, createChapter, {
        projectId,
        title: chapter.title,
      });
      chapterId = created.chapterId;
      chapters += 1;
    }
    for (const scene of chapter.scenes) {
      const created = await runCommand(session.driver, createScene, {
        projectId,
        title:
          scene.title.length > 0 ? scene.title : (scene.body.split("\n")[0] ?? "").slice(0, 60),
        chapterId,
      });
      const synopsis = richTextFromPlain(scene.body.split("\n")[0] ?? "");
      await runCommand(session.driver, updateScene, {
        projectId,
        sceneId: created.sceneId,
        patch: { synopsis, status: "drafting" },
      });
      // The prose goes through the same command the editor autosaves with, so the word count and
      // the search index are computed in exactly one place.
      await runCommand(session.driver, setSceneBody, {
        projectId,
        sceneId: created.sceneId,
        body: richTextFromPlain(scene.body),
      });
      scenes += 1;
    }
  }
  return { chapters, scenes };
}

export type { Command };
