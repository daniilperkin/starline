import type { ChangeEvent } from "../changes";
import type { Command } from "../commands";
import { syncMentions } from "../lore/mentions";
import { epochNow, type UUID } from "../primitives";
import { type PMDoc, pmDocToPlainText, richTextFromPlain } from "../richtext";
import {
  mentionFieldFor,
  removeMentionNodes,
  rewriteDocWithMention,
  targetLabels,
} from "./possible";
import type { LinkMentionResult } from "./types";

/**
 * The "Possible mentions" rewrite (spec §4.x: one-click Link rewrites that text range into a
 * `mention` node). One command = one transaction = one undo step; `unlinkMention` is its exact
 * inverse, which is what the undo toast runs.
 */

export interface LinkMentionArgs {
  projectId: UUID;
  sourceType: string;
  sourceId: UUID;
  field: string;
  targetType: string;
  targetId: UUID;
}

interface SourceRow {
  id: string;
  json: string | null;
  text: string;
}

async function loadSource(
  ctx: {
    tx: { query: <T>(sql: string, params?: readonly (string | number | null)[]) => Promise<T[]> };
  },
  args: LinkMentionArgs,
): Promise<{ table: string; jsonColumn: string; textColumn: string; row: SourceRow } | null> {
  const entry = mentionFieldFor(args.sourceType, args.field);
  if (!entry) return null;
  const rows = await ctx.tx.query<SourceRow>(
    `SELECT id, ${entry.jsonColumn} AS json, ${entry.textColumn} AS text FROM ${entry.table}
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [args.sourceId, args.projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return { table: entry.table, jsonColumn: entry.jsonColumn, textColumn: entry.textColumn, row };
}

function parseDoc(json: string | null, text: string): PMDoc | null {
  if (json !== null) {
    try {
      return JSON.parse(json) as PMDoc;
    } catch {
      // fall through to the plain-text projection
    }
  }
  return text.trim().length > 0 ? richTextFromPlain(text).json : null;
}

async function persist(
  ctx: {
    tx: {
      query: (sql: string, params?: readonly (string | number | null)[]) => Promise<unknown[]>;
    };
  },
  table: string,
  jsonColumn: string,
  textColumn: string,
  sourceId: UUID,
  projectId: UUID,
  doc: PMDoc | null,
  text: string,
): Promise<void> {
  await ctx.tx.query(
    `UPDATE ${table} SET ${jsonColumn} = ?, ${textColumn} = ?, updated_at = ?
      WHERE id = ? AND project_id = ?`,
    [doc === null ? null : JSON.stringify(doc), text, epochNow(), sourceId, projectId],
  );
}

/** Turns every plain-text occurrence of the target's name/aliases into a mention chip. */
export const linkMention: Command<LinkMentionArgs, LinkMentionResult> = {
  name: "search.linkMention",
  async run(ctx, args) {
    const source = await loadSource(ctx, args);
    if (!source) throw new Error(`no mention-capable field ${args.sourceType}.${args.field}`);
    const labels = await targetLabels(ctx.tx, args.projectId, args.targetType, args.targetId);
    const doc = parseDoc(source.row.json, source.row.text);
    const { doc: next, linked } = rewriteDocWithMention(
      doc,
      labels,
      args.targetType,
      args.targetId,
    );
    if (linked === 0 || next === null) return { result: { linked: 0 }, changes: [] };

    const text = pmDocToPlainText(next);
    await persist(
      ctx,
      source.table,
      source.jsonColumn,
      source.textColumn,
      args.sourceId,
      args.projectId,
      next,
      text,
    );
    await syncMentions(ctx.tx, args.sourceType, args.sourceId, args.field, next);
    return {
      result: { linked },
      changes: [
        { table: source.table, op: "update", id: args.sourceId, parentIds: [args.projectId] },
      ],
    };
  },
};

/** Inverse of `linkMention`: the target's chips become plain text again (the undo path). */
export const unlinkMention: Command<LinkMentionArgs, LinkMentionResult> = {
  name: "search.unlinkMention",
  async run(ctx, args) {
    const source = await loadSource(ctx, args);
    if (!source) throw new Error(`no mention-capable field ${args.sourceType}.${args.field}`);
    const doc = parseDoc(source.row.json, source.row.text);
    const { doc: next, linked } = removeMentionNodes(doc, args.targetType, args.targetId);
    if (linked === 0 || next === null) return { result: { linked: 0 }, changes: [] };

    const text = pmDocToPlainText(next);
    await persist(
      ctx,
      source.table,
      source.jsonColumn,
      source.textColumn,
      args.sourceId,
      args.projectId,
      next,
      text,
    );
    await syncMentions(ctx.tx, args.sourceType, args.sourceId, args.field, next);
    const changes: ChangeEvent[] = [
      { table: source.table, op: "update", id: args.sourceId, parentIds: [args.projectId] },
    ];
    return { result: { linked }, changes };
  },
};
