/**
 * Step-8 paste parser (spec §4.1 point 7): one scene per line, pasted from a spreadsheet
 * (TSV), a CSV-ish export or a plain numbered list.
 *
 * Column order follows the spec grid — `#`, POV, one-line description, est. words, chapter —
 * but every column except the one-line is optional and detected by shape:
 *   - a leading pure number is the row's `#` and is dropped;
 *   - a first cell matching a known character name (or alias, case-insensitive) is the POV;
 *   - a trailing pure number (optionally `~`, `,`/space separators, `w`/`words` suffix) is the
 *     estimated word count;
 *   - a trailing `Chapter 3` / `Part II` / `Act 1`-style cell (only when another cell follows
 *     the POV) is the chapter title.
 * Whatever remains is the one-line description. Lines that reduce to nothing are reported as
 * skipped; whitespace-only lines are ignored silently.
 */

export interface SceneListRow {
  /** 1-based line number in the pasted text — becomes `snowflakeSource.line` (spec §3.6). */
  line: number;
  oneLine: string;
  /** The matched display text; the command resolves it to a character id. */
  povName: string | null;
  estWords: number | null;
  chapterTitle: string | null;
}

export interface SceneListParse {
  rows: SceneListRow[];
  /** Content lines that produced no one-line description (counted in the import report). */
  skipped: Array<{ line: number; text: string }>;
}

export interface ParseSceneListOptions {
  /** Known character names + aliases, used to recognise a POV cell. */
  knownNames?: readonly string[];
}

const NUMBER_CELL_RE = /^~?\d[\d.,\s]*\s*(w|words?)?$/i;
const CHAPTER_CELL_RE = /^(chapter|part|act|ch\.?|scene)\s*[0-9ivxlc]+$/i;

function unquote(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function splitCells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map(unquote);
  if (line.includes("|")) return line.split("|").map(unquote);
  return [line.trim()];
}

function parseWordCount(cell: string): number | null {
  if (!NUMBER_CELL_RE.test(cell.trim())) return null;
  const digits = cell.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

function matchesName(cell: string, knownNames: readonly string[]): string | null {
  const needle = cell.trim().toLowerCase();
  if (needle.length === 0) return null;
  for (const name of knownNames) {
    if (name.trim().toLowerCase() === needle) return cell.trim();
  }
  return null;
}

/** Parses pasted scene-list text into rows (pure — no storage access). */
export function parseSceneList(text: string, options: ParseSceneListOptions = {}): SceneListParse {
  const knownNames = options.knownNames ?? [];
  const rows: SceneListRow[] = [];
  const skipped: Array<{ line: number; text: string }> = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? "";
    const lineNumber = index + 1;
    if (raw.trim().length === 0) continue; // blank separator lines are not "skipped"

    let cells = splitCells(raw).filter((cell) => cell.length > 0);
    if (cells.length === 0) {
      skipped.push({ line: lineNumber, text: raw.trim() });
      continue;
    }

    // A single-cell line may still carry list numbering: "12. The ferry crosses".
    if (cells.length === 1) {
      const stripped = (cells[0] ?? "").replace(/^\d+[.):]?\s+/, "").trim();
      if (/^\d+[.):]?$/.test(stripped)) {
        skipped.push({ line: lineNumber, text: raw.trim() }); // a stray number, not a scene
        continue;
      }
      cells = [stripped];
    }

    // `#` column.
    if (cells.length > 1 && /^\d+[.):]?$/.test((cells[0] ?? "").trim())) {
      cells = cells.slice(1);
    }

    // POV column.
    let povName: string | null = null;
    if (cells.length > 1) {
      const matched = matchesName(cells[0] ?? "", knownNames);
      if (matched !== null) {
        povName = matched;
        cells = cells.slice(1);
      }
    }

    // Trailing chapter cell (only when a description cell remains before it).
    let chapterTitle: string | null = null;
    const lastCell = (cells[cells.length - 1] ?? "").trim();
    if (cells.length > 1 && CHAPTER_CELL_RE.test(lastCell)) {
      chapterTitle = lastCell;
      cells = cells.slice(0, -1);
    }

    // Trailing estimated-word-count cell (only when a description cell remains before it).
    let estWords: number | null = null;
    if (cells.length > 1) {
      const parsed = parseWordCount(cells[cells.length - 1] ?? "");
      if (parsed !== null) {
        estWords = parsed;
        cells = cells.slice(0, -1);
      }
    }

    const oneLine = cells
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (oneLine.length === 0) {
      skipped.push({ line: lineNumber, text: raw.trim() });
      continue;
    }
    rows.push({ line: lineNumber, oneLine, povName, estWords, chapterTitle });
  }

  return { rows, skipped };
}
