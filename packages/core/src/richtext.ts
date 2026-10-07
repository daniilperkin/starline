/** ProseMirror/TipTap JSON node types (spec §3.2). */

export interface PMMark {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, string | number | boolean | null>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

export interface PMDoc {
  type: "doc";
  content: PMNode[];
}

/** Rich text value as stored in a row (two columns: `<name>_json`, `<name>_text`). */
export interface RichText {
  json: PMDoc | null;
  /** Plain-text projection, "" when empty. */
  text: string;
  /** Unicode-aware word count of `text`. */
  wordCount: number;
}

export const EMPTY_RICH_TEXT: RichText = { json: null, text: "", wordCount: 0 };

/** Node types whose children form a block — a newline is appended after them in the text projection. */
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "listItem",
  "codeBlock",
  "horizontalRule",
]);

/** Plain-text projection of a TipTap document: text runs joined, blocks newline-separated. */
export function pmDocToPlainText(doc: PMDoc | null | undefined): string {
  if (!doc) return "";
  const parts: string[] = [];
  const walk = (nodes: PMNode[] | undefined): void => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type === "text" && node.text) {
        parts.push(node.text);
      } else if (node.type === "mention" && node.attrs?.label != null) {
        // Mentions carry their label in attrs; keep it in the searchable projection.
        parts.push(String(node.attrs.label));
      } else if (node.content) {
        walk(node.content);
        if (BLOCK_TYPES.has(node.type)) parts.push("\n");
      }
    }
  };
  walk(doc.content);
  return parts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

let segmenter: Intl.Segmenter | null = null;
try {
  segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
} catch {
  segmenter = null;
}

/** Unicode-aware word count (Intl.Segmenter when available, whitespace split otherwise). */
export function countWords(text: string): number {
  if (!text) return 0;
  if (!segmenter) return text.split(/\s+/u).filter(Boolean).length;
  let n = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) n++;
  }
  return n;
}

export function makeRichText(json: PMDoc | null): RichText {
  const text = pmDocToPlainText(json);
  return { json, text, wordCount: countWords(text) };
}
