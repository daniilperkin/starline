import type { SqlValue } from "../commands";
import type { EntityType } from "../entities";
import type { UUID } from "../primitives";
import type { TagSummary } from "./types";

/** Read surface for tags (spec §4.4). */

export interface TagQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
  count?: number;
}

function toSummary(row: TagRow): TagSummary {
  return {
    id: row.id as UUID,
    name: row.name,
    color: row.color,
    count: Number(row.count ?? 0),
  };
}

/** Every tag of the project with its live attachment count, in name order (tag manager). */
export async function listTags(runner: TagQueryRunner, projectId: UUID): Promise<TagSummary[]> {
  const rows = await runner.query<TagRow>(
    `SELECT t.id, t.name, t.color, COUNT(et.entity_id) AS count
       FROM tag t
       LEFT JOIN entity_tag et ON et.tag_id = t.id
      WHERE t.project_id = ?
      GROUP BY t.id
      ORDER BY t.name COLLATE NOCASE`,
    [projectId],
  );
  return rows.map(toSummary);
}

/** One entity's tags, in name order (the chips row). */
export async function listEntityTags(
  runner: TagQueryRunner,
  entityType: EntityType,
  entityId: UUID,
): Promise<TagSummary[]> {
  const rows = await runner.query<TagRow>(
    `SELECT t.id, t.name, t.color
       FROM entity_tag et
       JOIN tag t ON t.id = et.tag_id
      WHERE et.entity_type = ? AND et.entity_id = ?
      ORDER BY t.name COLLATE NOCASE`,
    [entityType, entityId],
  );
  return rows.map(toSummary);
}

/**
 * Tags for a whole list of entities in ONE query — the outliner and the scene cards render
 * chips per row, and a per-row round trip would blow the outliner's budget.
 */
export async function listTagsForEntities(
  runner: TagQueryRunner,
  entityType: EntityType,
  entityIds: readonly UUID[],
): Promise<Map<string, TagSummary[]>> {
  const byEntity = new Map<string, TagSummary[]>();
  if (entityIds.length === 0) return byEntity;
  const ids = [...new Set(entityIds)].slice(0, 500);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await runner.query<TagRow & { entity_id: string }>(
    `SELECT et.entity_id, t.id, t.name, t.color
       FROM entity_tag et
       JOIN tag t ON t.id = et.tag_id
      WHERE et.entity_type = ? AND et.entity_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE`,
    [entityType, ...ids],
  );
  for (const row of rows) {
    const list = byEntity.get(row.entity_id) ?? [];
    list.push(toSummary(row));
    byEntity.set(row.entity_id, list);
  }
  return byEntity;
}

/** Live attachment count for one tag (the manager's delete confirmation). */
export async function countTagUsage(runner: TagQueryRunner, tagId: UUID): Promise<number> {
  const rows = await runner.query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM entity_tag WHERE tag_id = ?",
    [tagId],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Entities carrying a tag, newest-first by name — the manager's "used on" drill-down. */
export async function listTagUsage(
  runner: TagQueryRunner,
  tagId: UUID,
  limit = 50,
): Promise<Array<{ entityType: string; entityId: string; count: number }>> {
  const rows = await runner.query<{ entity_type: string; entity_id: string; total: number }>(
    `SELECT entity_type, entity_id, 1 AS total
       FROM entity_tag
      WHERE tag_id = ?
      ORDER BY entity_type, entity_id
      LIMIT ?`,
    [tagId, limit],
  );
  return rows.map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    count: Number(row.total),
  }));
}
