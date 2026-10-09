import type { ChangeEvent } from "../changes";
import type { Command } from "../commands";
import type { EntityType } from "../entities";
import { epochNow, type UUID } from "../primitives";
import { TRASH_ENTITY_TYPES, TRASH_RETENTION_DAYS, type TrashEntityType } from "./types";

/** Table behind each trashable entity type — the only place SQL identifiers come from. */
const TRASH_TABLES: Record<TrashEntityType, string> = {
  character: "character",
  scene: "scene",
  chapter: "chapter",
  plotline: "plotline",
  lore_entry: "lore_entry",
};

function assertTrashable(entityType: EntityType): asserts entityType is TrashEntityType {
  if (!(TRASH_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    throw new Error(`entity type "${entityType}" is not trashable yet`);
  }
}

export interface RestoreEntityArgs {
  projectId: UUID;
  entityType: EntityType;
  entityId: UUID;
}

export interface RestoreEntityResult {
  restored: boolean;
}

/**
 * Undeletes one soft-deleted row (the Trash "Restore" action and the undo inverse of every
 * delete). Returns `restored: false` when the row is gone — e.g. purged meanwhile.
 */
export const restoreEntity: Command<RestoreEntityArgs, RestoreEntityResult> = {
  name: "trash.restore",
  async run(ctx, args) {
    assertTrashable(args.entityType);
    const table = TRASH_TABLES[args.entityType];
    const found = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM ${table} WHERE id = ? AND project_id = ? AND deleted_at IS NOT NULL`,
      [args.entityId, args.projectId],
    );
    if (found.length === 0) return { result: { restored: false }, changes: [] };
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE ${table} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND project_id = ?`,
      [now, args.entityId, args.projectId],
    );
    return {
      result: { restored: true },
      changes: [{ table, op: "update", id: args.entityId, parentIds: [args.projectId] }],
    };
  },
};

export interface PurgeExpiredTrashArgs {
  projectId: UUID;
  /** Retention window in days (spec §5.3 default: 30). */
  retentionDays?: number;
  /** Test seam; production callers omit it. */
  now?: number;
}

export interface TrashPurgeResult {
  purged: number;
  byType: Partial<Record<TrashEntityType, number>>;
}

/**
 * Hard-deletes every soft-deleted row older than the retention window (spec §5.3: 30-day
 * auto-purge). Runs on library open; FK cascades clean dependents at purge time (spec §3.12).
 */
export const purgeExpiredTrash: Command<PurgeExpiredTrashArgs, TrashPurgeResult> = {
  name: "trash.purgeExpired",
  async run(ctx, args) {
    const cutoff =
      (args.now ?? epochNow()) - (args.retentionDays ?? TRASH_RETENTION_DAYS) * 86_400_000;
    const byType: Partial<Record<TrashEntityType, number>> = {};
    let purged = 0;
    const changes: ChangeEvent[] = [];
    // Scenes first: a purged chapter would otherwise null their chapter_id before they go.
    for (const entityType of ["scene", "chapter", "plotline", "character", "lore_entry"] as const) {
      const table = TRASH_TABLES[entityType];
      const count = await ctx.tx.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table}
          WHERE project_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?`,
        [args.projectId, cutoff],
      );
      const n = count[0]?.n ?? 0;
      if (n === 0) continue;
      await ctx.tx.query(
        `DELETE FROM ${table} WHERE project_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?`,
        [args.projectId, cutoff],
      );
      byType[entityType] = n;
      purged += n;
      changes.push({ table, op: "delete", id: args.projectId, parentIds: [args.projectId] });
    }
    return { result: { purged, byType }, changes };
  },
};

export interface EmptyTrashArgs {
  projectId: UUID;
}

/** "Empty trash": permanently deletes everything soft-deleted, regardless of age. */
export const emptyTrash: Command<EmptyTrashArgs, TrashPurgeResult> = {
  name: "trash.empty",
  async run(ctx, args) {
    const byType: Partial<Record<TrashEntityType, number>> = {};
    let purged = 0;
    const changes: ChangeEvent[] = [];
    for (const entityType of ["scene", "chapter", "plotline", "character", "lore_entry"] as const) {
      const table = TRASH_TABLES[entityType];
      const count = await ctx.tx.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ? AND deleted_at IS NOT NULL`,
        [args.projectId],
      );
      const n = count[0]?.n ?? 0;
      if (n === 0) continue;
      await ctx.tx.query(`DELETE FROM ${table} WHERE project_id = ? AND deleted_at IS NOT NULL`, [
        args.projectId,
      ]);
      byType[entityType] = n;
      purged += n;
      changes.push({ table, op: "delete", id: args.projectId, parentIds: [args.projectId] });
    }
    return { result: { purged, byType }, changes };
  },
};
