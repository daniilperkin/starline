import type { SqlValue } from "../commands";
import type { UUID } from "../primitives";
import { type PMDoc, type PMNode, pmDocToPlainText } from "../richtext";
import { countLabelOccurrences, labelPattern, snippetAround } from "./text";
import type { PossibleMention } from "./types";

/**
 * "Possible mentions" (spec §4.x: unlinked occurrences, one-click Link) and the rewrite that
 * turns a plain-text range into a real mention chip — one command, one transaction, undoable.
 *
 * The scan reads the denormalised `*_text` columns (cheap, already maintained) and subtracts
 * what the `mention` mirror already knows about, so the list only ever shows *unlinked* hits.
 */

export interface PossibleRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/** Rich-text fields that can carry mentions, with the columns behind them (spec §3.2). */
export interface MentionField {
  sourceType: "character" | "lore" | "scene" | "chapter" | "note";
  table: string;
  field: string;
  jsonColumn: string;
  textColumn: string;
  titleColumn: string;
}

export const MENTION_FIELDS: readonly MentionField[] = [
  {
    sourceType: "lore",
    table: "lore_entry",
    field: "body",
    jsonColumn: "body_json",
    textColumn: "body_text",
    titleColumn: "name",
  },
  {
    sourceType: "scene",
    table: "scene",
    field: "synopsis",
    jsonColumn: "synopsis_json",
    textColumn: "synopsis_text",
    titleColumn: "title",
  },
  {
    sourceType: "character",
    table: "character",
    field: "storyline",
    jsonColumn: "storyline_json",
    textColumn: "storyline_text",
    titleColumn: "name",
  },
  {
    sourceType: "character",
    table: "character",
    field: "backstory",
    jsonColumn: "backstory_json",
    textColumn: "backstory_text",
    titleColumn: "name",
  },
  {
    sourceType: "chapter",
    table: "chapter",
    field: "summary",
    jsonColumn: "summary_json",
    textColumn: "summary_text",
    titleColumn: "title",
  },
  {
    sourceType: "note",
    table: "idea_note",
    field: "body",
    jsonColumn: "body_json",
    textColumn: "body_text",
    titleColumn: "title",
  },
];

export function mentionFieldFor(sourceType: string, field: string): MentionField | null {
  return (
    MENTION_FIELDS.find((entry) => entry.sourceType === sourceType && entry.field === field) ?? null
  );
}

/** Display labels a target can be found by: name + aliases, or the row's title. */
export async function targetLabels(
  runner: PossibleRunner,
  projectId: UUID,
  targetType: string,
  targetId: UUID,
): Promise<string[]> {
  if (targetType === "character" || targetType === "lore") {
    const table = targetType === "character" ? "character" : "lore_entry";
    const rows = await runner.query<{ name: string; aliases: string }>(
      `SELECT name, aliases FROM ${table} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [targetId, projectId],
    );
    const row = rows[0];
    if (!row) return [];
    let aliases: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.aliases);
      if (Array.isArray(parsed))
        aliases = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      aliases = [];
    }
    return [row.name, ...aliases];
  }
  const table =
    targetType === "scene"
      ? "scene"
      : targetType === "chapter"
        ? "chapter"
        : targetType === "note"
          ? "idea_note"
          : null;
  if (table === null) return [];
  const column = table === "scene" || table === "chapter" ? "title" : "title";
  const rows = await runner.query<{ title: string }>(
    `SELECT ${column} AS title FROM ${table} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [targetId, projectId],
  );
  return rows[0]?.title ? [rows[0].title] : [];
}

/**
 * Unlinked occurrences of the target across every mention-capable field, biggest first. Rows
 * already carrying a chip for this target have their linked count subtracted, so a field that
 * mentions "Emberfall" twice with one chip left still reports the one plain-text hit.
 */
export async function listPossibleMentions(
  runner: PossibleRunner,
  projectId: UUID,
  targetType: string,
  targetId: UUID,
  limit = 12,
): Promise<PossibleMention[]> {
  const labels = await targetLabels(runner, projectId, targetType, targetId);
  if (labels.length === 0) return [];

  const linkedRows = await runner.query<{
    source_type: string;
    source_id: string;
    field: string;
    count: number;
  }>(
    `SELECT source_type, source_id, field, count FROM mention
      WHERE target_type = ? AND target_id = ?`,
    [targetType, targetId],
  );
  const linked = new Map<string, number>();
  for (const row of linkedRows) {
    linked.set(`${row.source_type}:${row.source_id}:${row.field}`, Number(row.count));
  }

  const found: PossibleMention[] = [];
  for (const entry of MENTION_FIELDS) {
    const rows = await runner.query<{ id: string; title: string; body: string }>(
      `SELECT id, ${entry.titleColumn} AS title, ${entry.textColumn} AS body FROM ${entry.table}
        WHERE project_id = ? AND deleted_at IS NULL AND ${entry.textColumn} <> ''
        LIMIT 2000`,
      [projectId],
    );
    for (const row of rows) {
      if (entry.sourceType === targetType && row.id === targetId) continue;
      const occurrences = countLabelOccurrences(row.body, labels);
      if (occurrences === 0) continue;
      const alreadyLinked = linked.get(`${entry.sourceType}:${row.id}:${entry.field}`) ?? 0;
      const unlinked = occurrences - alreadyLinked;
      if (unlinked <= 0) continue;
      found.push({
        sourceType: entry.sourceType,
        sourceId: row.id as UUID,
        field: entry.field,
        title: row.title.trim() || `(${entry.sourceType})`,
        detail: entry.sourceType === "scene" ? "synopsis" : entry.field,
        occurrences: unlinked,
        snippet: snippetAround(row.body, labels),
      });
    }
  }
  return found.sort((a, b) => b.occurrences - a.occurrences).slice(0, limit);
}

export interface RewriteResult {
  doc: PMDoc | null;
  linked: number;
}

/**
 * Rewrites every plain-text occurrence of the labels into a mention chip (pure — the command
 * persists the result). Text inside existing chips is never touched: only `text` nodes are
 * split, so prose keeps its marks and nothing is silently re-ordered.
 */
export function rewriteDocWithMention(
  doc: PMDoc | null,
  labels: readonly string[],
  targetType: string,
  targetId: string,
): RewriteResult {
  const pattern = labelPattern(labels);
  if (!doc || !pattern) return { doc, linked: 0 };
  let linked = 0;

  const rewriteText = (text: string, marks: PMNode["marks"]): PMNode[] => {
    const nodes: PMNode[] = [];
    let cursor = 0;
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > cursor) {
        nodes.push({ type: "text", text: text.slice(cursor, index), ...(marks ? { marks } : {}) });
      }
      nodes.push({
        type: "mention",
        attrs: { entityType: targetType, entityId: targetId, label: match[0] },
      });
      linked += 1;
      cursor = index + match[0].length;
    }
    if (cursor < text.length) {
      nodes.push({ type: "text", text: text.slice(cursor), ...(marks ? { marks } : {}) });
    }
    return nodes.length > 0 ? nodes : [{ type: "text", text, ...(marks ? { marks } : {}) }];
  };

  // Text nodes hold no children, so a rewrite replaces the parent's child list in place.
  function rewriteChildren(nodes: PMNode[] | undefined): PMNode[] | undefined {
    if (!nodes) return nodes;
    const next: PMNode[] = [];
    for (const node of nodes) {
      if (node.type === "text" && typeof node.text === "string") {
        next.push(...rewriteText(node.text, node.marks));
        continue;
      }
      next.push(rewriteNode(node));
    }
    return next;
  }

  function rewriteNode(node: PMNode): PMNode {
    const children = rewriteChildren(node.content);
    return children ? { ...node, content: children } : node;
  }

  const content = (doc.content ?? []).map((node) => rewriteNode(node));
  return { doc: { type: "doc", content }, linked };
}

/**
 * The inverse rewrite (the undo path): every chip for the target becomes plain text again,
 * which is exactly what the source row looked like before the link command ran.
 */
export function removeMentionNodes(
  doc: PMDoc | null,
  targetType: string,
  targetId: string,
): RewriteResult {
  if (!doc) return { doc, linked: 0 };
  let removed = 0;

  const walk = (node: PMNode): PMNode[] => {
    if (node.type === "mention") {
      const attrs = node.attrs ?? {};
      if (attrs.entityType === targetType && attrs.entityId === targetId) {
        removed += 1;
        return [{ type: "text", text: String(attrs.label ?? "") }];
      }
      return [node];
    }
    const children = node.content;
    if (!children) return [node];
    const next: PMNode[] = [];
    for (const child of children) next.push(...walk(child));
    return [{ ...node, content: next }];
  };

  const content: PMNode[] = [];
  for (const node of doc.content ?? []) content.push(...walk(node));
  return { doc: { type: "doc", content }, linked: removed };
}

/** Plain text after a rewrite — kept in sync with what `syncMentions` will mirror. */
export function rewriteTextProjection(doc: PMDoc | null): string {
  return pmDocToPlainText(doc);
}
