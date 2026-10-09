import type { SqlRunner } from "../commands";
import type { UUID } from "../primitives";
import type { PMDoc, PMNode } from "../richtext";

/**
 * Mention mirroring (spec §3.8/§3.10, PLAN slice 6): every rich-text save rewrites the rows of
 * the `mention` table for that source field. The editor stores chips as `mention` nodes with
 * `{ entityType, entityId, label }` attrs; the mirror is what backlinks and search read.
 */

export type MentionTargetType = "character" | "lore";

export interface ExtractedMention {
  targetType: MentionTargetType;
  targetId: UUID;
  count: number;
}

function isMentionNode(node: PMNode): boolean {
  return node.type === "mention" && node.attrs?.entityId != null && node.attrs?.entityType != null;
}

/** Walks a TipTap document and counts mentions per target. Unknown entity types are ignored. */
export function extractMentions(doc: PMDoc | null | undefined): ExtractedMention[] {
  const counts = new Map<string, ExtractedMention>();
  const walk = (nodes: PMNode[] | undefined): void => {
    if (!nodes) return;
    for (const node of nodes) {
      if (isMentionNode(node)) {
        const targetType = String(node.attrs?.entityType);
        if (targetType === "character" || targetType === "lore") {
          const targetId = String(node.attrs?.entityId) as UUID;
          const key = `${targetType}:${targetId}`;
          const existing = counts.get(key);
          if (existing) existing.count += 1;
          else counts.set(key, { targetType, targetId, count: 1 });
        }
      }
      walk(node.content);
    }
  };
  walk(doc?.content);
  return [...counts.values()];
}

/**
 * Replaces the mention rows of one source field. Called inside the same transaction as the
 * write that changed the text, so the mirror can never drift.
 */
export async function syncMentions(
  tx: SqlRunner,
  sourceType: string,
  sourceId: UUID,
  field: string,
  doc: PMDoc | null | undefined,
): Promise<number> {
  await tx.query("DELETE FROM mention WHERE source_type = ? AND source_id = ? AND field = ?", [
    sourceType,
    sourceId,
    field,
  ]);
  const mentions = extractMentions(doc);
  for (const mention of mentions) {
    await tx.query(
      `INSERT INTO mention (source_type, source_id, field, target_type, target_id, count)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sourceType, sourceId, field, mention.targetType, mention.targetId, mention.count],
    );
  }
  return mentions.length;
}

/** The TipTap node name + attrs the editor and the mirror agree on. */
export const MENTION_NODE = "mention" as const;

export interface MentionAttrs {
  entityType: MentionTargetType;
  entityId: string;
  label: string;
}
