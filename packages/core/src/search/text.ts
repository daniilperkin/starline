/**
 * Pure text helpers for search and cross-references: FTS query building (never pass raw user
 * input to `MATCH` — FTS5 syntax errors abort the query), snippet windows, word-boundary name
 * matching, and the near-duplicate scan. All pure so the unit suite can pin them.
 */

/** Characters FTS5 treats as syntax; user input is stripped of them before quoting. */
const FTS_SYNTAX_RE = /["'()*:^-]/g;
const WORD_CHAR = "\\p{L}\\p{N}_";

/**
 * Turns free text into an FTS5 query: each term is quoted, joined with AND, and the last one
 * gets a prefix `*` so results appear while typing ("sund" finds "Sundered"). Returns null when
 * nothing searchable is left — the caller then skips the FTS branch entirely.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .replace(FTS_SYNTAX_RE, " ")
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, 6);
  if (terms.length === 0) return null;
  return terms
    .map((term, index) => (index === terms.length - 1 ? `"${term}"*` : `"${term}"`))
    .join(" AND ");
}

/**
 * The trigram index matches substrings, which is what makes "mberfa" or a misspelled name
 * findable. Needs at least three characters — below that the token index with its `prefix`
 * option already covers it.
 */
export function toTrigramQuery(input: string): string | null {
  const cleaned = input.toLowerCase().replace(FTS_SYNTAX_RE, "").replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 ? `"${cleaned}"` : null;
}

/** Escapes a string for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A word-boundary matcher for a set of labels ("Mina Voss", "Voss"). Longest labels first so
 * "Mina Voss" wins over "Voss" at the same position.
 */
export function labelPattern(labels: readonly string[]): RegExp | null {
  const usable = labels
    .map((label) => label.trim())
    .filter((label) => label.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (usable.length === 0) return null;
  const alternation = usable.map(escapeRegExp).join("|");
  return new RegExp(`(?<![${WORD_CHAR}])(${alternation})(?![${WORD_CHAR}])`, "giu");
}

/** Number of unlinked name occurrences in a plain-text body. */
export function countLabelOccurrences(text: string, labels: readonly string[]): number {
  const pattern = labelPattern(labels);
  if (!pattern) return 0;
  return [...text.matchAll(pattern)].length;
}

export interface LabelMatch {
  start: number;
  end: number;
  label: string;
}

/** First occurrence of any label in a plain-text body, or null. */
export function firstLabelMatch(text: string, labels: readonly string[]): LabelMatch | null {
  const pattern = labelPattern(labels);
  if (!pattern) return null;
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return null;
  return { start: match.index, end: match.index + match[0].length, label: match[0] };
}

/**
 * A readable window around the first label occurrence: `…` padded, newlines flattened, and
 * never longer than `radius * 2`. Falls back to the head of the text when the label is gone
 * (a stale mirror — the snippet still shows the reader where the mention lives).
 */
export function snippetAround(text: string, labels: readonly string[], radius = 70): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  const match = firstLabelMatch(flat, labels);
  if (!match) return flat.length <= radius ? flat : `${flat.slice(0, radius)}…`;
  const start = Math.max(0, match.start - radius);
  const end = Math.min(flat.length, match.end + radius);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** Compact one-line window for a FTS body hit (no label required). */
export function headSnippet(text: string, radius = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= radius ? flat : `${flat.slice(0, radius)}…`;
}

/** Levenshtein distance with the usual two-row optimisation (names are short). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Lowercase, strip punctuation and collapse spaces — the form duplicate names compare in. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NameEntry {
  entityType: string;
  entityId: string;
  name: string;
}

export interface DuplicatePair {
  a: NameEntry;
  b: NameEntry;
  distance: number;
}

/**
 * Pairs whose normalised names are one edit apart (two for longer names). This catches the
 * realistic slip — "Emberfall" vs "Emberfal", "Mira Holt" vs "Mira Hold" — without flagging
 * every shared surname, which is normal in a cast.
 */
export function nearDuplicatePairs(entries: readonly NameEntry[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const normalized = entries.map((entry) => ({ entry, key: normalizeName(entry.name) }));
  for (let i = 0; i < normalized.length; i++) {
    const left = normalized[i];
    if (!left || left.key.length < 3) continue;
    for (let j = i + 1; j < normalized.length; j++) {
      const right = normalized[j];
      if (!right || right.key.length < 3) continue;
      if (Math.abs(left.key.length - right.key.length) > 2) continue;
      const limit = Math.min(left.key.length, right.key.length) <= 6 ? 1 : 2;
      const distance = levenshtein(left.key, right.key);
      if (distance > 0 && distance <= limit) {
        pairs.push({ a: left.entry, b: right.entry, distance });
      }
    }
  }
  return pairs.sort((x, y) => x.distance - y.distance);
}
