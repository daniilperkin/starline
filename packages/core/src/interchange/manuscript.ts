/**
 * Manuscript-shaped output (spec §4.5.1): plain text, Markdown and the self-contained HTML file.
 * All three walk the same outline — part → chapter → scene in `order_key` order — and differ only
 * in how they render it, so a fix to the walk fixes every format at once.
 */
import type { PMDoc } from "../richtext";
import { pmDocToPlainText } from "../richtext";
import type { ExportRow, ProjectExport } from "./types";

export interface ManuscriptOptions {
  /** Between scenes inside one chapter (`#` in the manuscript convention, `***` by default). */
  sceneSeparator?: string;
  includeSynopsis?: boolean;
  includeNotes?: boolean;
  /** Include the draft body (a planning document usually does not). */
  includeBody?: boolean;
  /** Scene statuses to keep; empty = every scene. */
  statuses?: readonly string[];
  /** Chapter ids to keep; empty = every chapter (slice 28's chapter scope). */
  chapters?: readonly string[];
}

export interface ManuscriptScene {
  chapterTitle: string;
  chapterSummary: string;
  partTitle: string;
  scene: ExportRow;
  pov: string;
  location: string;
  synopsis: string;
  /** The step-8 line: the plan for a scene that has no synopsis yet. */
  oneLine: string;
  body: string;
}

export interface ManuscriptDocument {
  title: string;
  subtitle: string;
  author: string;
  logline: string;
  description: string;
  scenes: ManuscriptScene[];
  /** Character sheets for the planning preset. */
  characters: ExportRow[];
  /** World bible for the planning preset. */
  lore: ExportRow[];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return pmDocToPlainText(value as PMDoc);
}

/**
 * Rich text is stored as `{json, text}` pairs; a scene that was imported or pasted may carry only
 * the denormalised text, so every read falls back to the `_text` column before giving up.
 */
function richText(row: ExportRow, jsonColumn: string, textColumn: string): string {
  const json = text(row[jsonColumn]);
  if (json.trim().length > 0) return json;
  const plain = row[textColumn];
  return typeof plain === "string" ? plain : "";
}

/**
 * The step-8 line lives in the scene's `snowflake_source` JSON until the writer promotes it to
 * the synopsis ("Copy to scene synopsis"). A planning document has to show the plan either way,
 * so every scene carries its one-liner with the synopsis as the preferred copy.
 */
function oneLineOf(scene: ExportRow): string {
  const raw = scene.snowflake_source;
  if (typeof raw !== "string" || raw.length === 0) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      const line = (parsed as { oneLine?: unknown }).oneLine;
      if (typeof line === "string") return line.trim();
    }
  } catch {
    // A broken source blob must not break an export.
  }
  return "";
}

/** Everything a manuscript needs, in reading order. */
export function buildManuscript(
  data: ProjectExport,
  options: ManuscriptOptions = {},
): ManuscriptDocument {
  const tables = data.tables;
  const project = data.project;
  const parts = tables.parts ?? [];
  const chapters = tables.chapters ?? [];
  const scenes = tables.scenes ?? [];
  const characters = tables.characters ?? [];
  const lore = tables.loreEntries ?? [];
  const names = new Map(characters.map((row) => [String(row.id), String(row.name ?? "")]));
  const loreNames = new Map(lore.map((row) => [String(row.id), String(row.name ?? "")]));
  const chapterById = new Map(chapters.map((row) => [String(row.id), row]));
  const partById = new Map(parts.map((row) => [String(row.id), row]));
  const statuses = options.statuses ?? [];
  const chapterFilter = options.chapters ?? [];

  const partOf = (chapterId: string): ExportRow | null => {
    const chapter = chapterById.get(chapterId);
    if (chapter === undefined) return null;
    const partId = typeof chapter.part_id === "string" ? chapter.part_id : "";
    return partById.get(partId) ?? null;
  };

  // Reading order is the outline's: part → chapter → scene, each by its own `order_key`, with the
  // unassigned pool last. Sorting scenes by their bare `order_key` interleaves chapters whenever
  // the outline numbers scenes per chapter (which the step-8 import does), which would print a
  // chapter heading again for every scene.
  const rank = (row: ExportRow | null | undefined): string =>
    row === null || row === undefined ? "￿" : String(row.order_key ?? "￿");
  const orderKey = (scene: ExportRow): [string, string, string] => {
    const chapterId = typeof scene.chapter_id === "string" ? scene.chapter_id : "";
    const chapter = chapterById.get(chapterId) ?? null;
    const part = partOf(chapterId);
    return [rank(part), rank(chapter), String(scene.order_key ?? "")];
  };
  const ordered = [...scenes].sort((a, b) => {
    const left = orderKey(a);
    const right = orderKey(b);
    for (let index = 0; index < 3; index++) {
      const comparison = (left[index] ?? "").localeCompare(right[index] ?? "");
      if (comparison !== 0) return comparison;
    }
    return 0;
  });
  const kept: ManuscriptScene[] = [];
  for (const scene of ordered) {
    if (statuses.length > 0 && !statuses.includes(String(scene.status ?? ""))) continue;
    if (chapterFilter.length > 0 && !chapterFilter.includes(String(scene.chapter_id ?? "")))
      continue;
    const chapterId = typeof scene.chapter_id === "string" ? scene.chapter_id : "";
    const chapter = chapterById.get(chapterId);
    const part = partOf(chapterId);
    kept.push({
      chapterTitle: String(chapter?.title ?? ""),
      chapterSummary: richText(chapter ?? {}, "summary_json", "summary_text"),
      partTitle: String(part?.title ?? ""),
      scene,
      pov:
        typeof scene.pov_character_id === "string" ? (names.get(scene.pov_character_id) ?? "") : "",
      location:
        typeof scene.location_id === "string" ? (loreNames.get(scene.location_id) ?? "") : "",
      synopsis: richText(scene, "synopsis_json", "synopsis_text"),
      oneLine: oneLineOf(scene),
      body: richText(scene, "body_json", "body_text"),
    });
  }

  return {
    title: String(project.title ?? "Untitled"),
    subtitle: String(project.subtitle ?? ""),
    author: String(project.author_name ?? ""),
    logline: String(project.logline ?? ""),
    description: String(project.description_text ?? ""),
    scenes: kept,
    characters,
    lore,
  };
}

/** `#` / `***` style scene separator, configurable because every market prints differently. */
export function buildPlainText(
  document: ManuscriptDocument,
  options: ManuscriptOptions = {},
): string {
  const separator = options.sceneSeparator ?? "#";
  const lines: string[] = [];
  lines.push(document.title);
  if (document.subtitle.length > 0) lines.push(document.subtitle);
  if (document.author.length > 0) {
    lines.push("");
    lines.push(document.author);
  }
  lines.push("");
  let lastPart = "";
  let lastChapter = "";
  document.scenes.forEach((entry, index) => {
    if (entry.partTitle !== lastPart && entry.partTitle.length > 0) {
      lastPart = entry.partTitle;
      lastChapter = "";
      lines.push("");
      lines.push(entry.partTitle.toUpperCase());
    }
    if (entry.chapterTitle !== lastChapter) {
      lastChapter = entry.chapterTitle;
      lines.push("");
      lines.push(entry.chapterTitle.length > 0 ? entry.chapterTitle : "Unassigned");
      lines.push("");
    } else if (index > 0) {
      lines.push("");
      lines.push(separator);
      lines.push("");
    }
    const heading = String(entry.scene.title ?? "").trim();
    if (heading.length > 0) {
      lines.push(heading);
      lines.push("");
    }
    if (options.includeSynopsis === true && entry.synopsis.trim().length > 0) {
      lines.push(entry.synopsis.trim());
      lines.push("");
    }
    if (options.includeBody !== false && entry.body.trim().length > 0) {
      lines.push(entry.body.trim());
      lines.push("");
    }
    // The scene's own notes (slice 28's "include notes"): planning material kept apart from the
    // prose, so a manuscript export can carry it without pretending it is text.
    if (options.includeNotes === true) {
      const notes = String(entry.scene.notes_text ?? "").trim();
      if (notes.length > 0) {
        lines.push(notes);
        lines.push("");
      }
    }
  });
  return `${lines
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd()}\n`;
}

export function buildMarkdownManuscript(
  document: ManuscriptDocument,
  options: ManuscriptOptions = {},
): string {
  const separator = options.sceneSeparator ?? "***";
  const lines: string[] = [`# ${document.title}`, ""];
  if (document.subtitle.length > 0) lines.push(`*${document.subtitle}*`, "");
  if (document.author.length > 0) lines.push(`**${document.author}**`, "");
  if (document.logline.length > 0) lines.push(`> ${document.logline}`, "");
  let lastPart = "";
  let lastChapter = "";
  for (const entry of document.scenes) {
    if (entry.partTitle !== lastPart && entry.partTitle.length > 0) {
      lastPart = entry.partTitle;
      lines.push(`# ${entry.partTitle}`, "");
    }
    if (entry.chapterTitle !== lastChapter) {
      lastChapter = entry.chapterTitle;
      lines.push(`## ${entry.chapterTitle.length > 0 ? entry.chapterTitle : "Unassigned"}`, "");
    } else {
      lines.push(separator, "");
    }
    const title = String(entry.scene.title ?? "").trim();
    if (title.length > 0) lines.push(`### ${title}`, "");
    if (options.includeSynopsis === true && entry.synopsis.trim().length > 0) {
      lines.push(`*${entry.synopsis.trim()}*`, "");
    }
    if (options.includeBody !== false && entry.body.trim().length > 0) {
      lines.push(entry.body.trim(), "");
    }
  }
  return `${lines
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd()}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One self-contained HTML file (spec §4.5.1): print-ready, no scripts, no external requests,
 * light/dark via `prefers-color-scheme` — the "send it to a beta reader" format.
 */
export function buildHtml(document: ManuscriptDocument, options: ManuscriptOptions = {}): string {
  const separator = options.sceneSeparator ?? "#";
  const body: string[] = [];
  let lastPart = "";
  let lastChapter = "";
  let first = true;
  for (const entry of document.scenes) {
    if (entry.partTitle !== lastPart && entry.partTitle.length > 0) {
      lastPart = entry.partTitle;
      lastChapter = "";
      body.push(`<h2 class="part">${escapeHtml(entry.partTitle)}</h2>`);
    }
    if (entry.chapterTitle !== lastChapter) {
      lastChapter = entry.chapterTitle;
      body.push(
        `<h3 class="chapter">${escapeHtml(entry.chapterTitle.length > 0 ? entry.chapterTitle : "Unassigned")}</h3>`,
      );
      first = true;
    } else if (!first) {
      body.push(`<p class="break">${escapeHtml(separator)}</p>`);
    }
    first = false;
    const title = String(entry.scene.title ?? "").trim();
    if (title.length > 0) body.push(`<h4 class="scene">${escapeHtml(title)}</h4>`);
    if (options.includeSynopsis === true && entry.synopsis.trim().length > 0) {
      body.push(`<p class="synopsis">${escapeHtml(entry.synopsis.trim())}</p>`);
    }
    if (options.includeBody !== false && entry.body.trim().length > 0) {
      for (const paragraph of entry.body.trim().split(/\n{2,}/)) {
        body.push(`<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`);
      }
    }
  }
  const meta = [
    document.author.length > 0 ? `<p class="author">${escapeHtml(document.author)}</p>` : "",
    document.logline.length > 0 ? `<p class="logline">${escapeHtml(document.logline)}</p>` : "",
  ]
    .filter((part) => part.length > 0)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.title)}</title>
<style>
  :root { color-scheme: light dark; --ink: #1a1a1a; --paper: #fdfdfb; --muted: #6b6b6b; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e8e6e1; --paper: #14161c; --muted: #9a9a9a; } }
  html { background: var(--paper); color: var(--ink); }
  body { margin: 0 auto; padding: 4rem 1.25rem 6rem; max-width: 40rem;
         font: 400 1.05rem/1.7 Georgia, "Times New Roman", serif; }
  h1 { font-size: 1.9rem; margin: 0 0 0.5rem; }
  h2.part { font-size: 1.4rem; letter-spacing: 0.08em; text-transform: uppercase;
            margin: 4rem 0 1.5rem; text-align: center; }
  h3.chapter { font-size: 1.25rem; margin: 3rem 0 1.25rem; }
  h4.scene { font-size: 1.05rem; margin: 2rem 0 0.5rem; color: var(--muted); font-weight: 600; }
  p { margin: 0 0 1rem; }
  p.break { text-align: center; color: var(--muted); margin: 1.5rem 0; }
  p.synopsis { font-style: italic; color: var(--muted); }
  p.author, p.logline { color: var(--muted); }
  @media print { body { padding: 0; max-width: none; } h3.chapter { page-break-before: always; } }
</style>
</head>
<body>
<h1>${escapeHtml(document.title)}</h1>
${document.subtitle.length > 0 ? `<p class="subtitle">${escapeHtml(document.subtitle)}</p>` : ""}
${meta}
${body.join("\n")}
</body>
</html>
`;
}
