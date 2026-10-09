import type { ChangeEvent } from "../changes";
import type { SqlRunner } from "../commands";
import type { EntityType } from "../entities";
import type { UUID } from "../primitives";
import { TAG_MAX_PER_ENTITY, TAG_TARGET_TABLES } from "./types";

/**
 * The `entity_tag` join-table helpers, kept in their own module so `scenes/commands.ts` can use
 * them without importing `tags/commands.ts` (which pulls the scene tag-colour helper back out of
 * `scenes/types.ts` — a cycle). Everything that writes a tag link goes through here.
 */

/** Replaces one entity's tag set. */
export async function replaceEntityTags(
  tx: SqlRunner,
  entityType: EntityType,
  entityId: UUID,
  tagIds: readonly UUID[],
): Promise<ChangeEvent[]> {
  const unique = [...new Set(tagIds)].slice(0, TAG_MAX_PER_ENTITY);
  await tx.query("DELETE FROM entity_tag WHERE entity_type = ? AND entity_id = ?", [
    entityType,
    entityId,
  ]);
  for (const tagId of unique) {
    await tx.query("INSERT INTO entity_tag (tag_id, entity_type, entity_id) VALUES (?, ?, ?)", [
      tagId,
      entityType,
      entityId,
    ]);
  }
  return [{ table: "entity_tag", op: "update", id: entityId, parentIds: [] }];
}

/** Refuses to attach to a row that does not exist (the join table has no FK to lean on). */
export async function assertTagTargetLive(
  tx: SqlRunner,
  entityType: EntityType,
  entityId: UUID,
  projectId: UUID,
): Promise<void> {
  const table = TAG_TARGET_TABLES[entityType];
  if (table === undefined) throw new Error(`tags cannot be attached to ${entityType}`);
  const rows = await tx.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${table} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [entityId, projectId],
  );
  if (Number(rows[0]?.total ?? 0) === 0) throw new Error(`${entityType} not found`);
}
