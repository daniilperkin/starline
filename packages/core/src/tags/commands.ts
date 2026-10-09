import type { Command, SqlRunner } from "../commands";
import type { EntityType } from "../entities";
import { epochNow, newUuid, type UUID } from "../primitives";
import { tagColorFor } from "../scenes/types";
import { assertTagTargetLive, replaceEntityTags } from "./join";
import { isTagTarget, normalizeTagName, TAG_MAX_PER_ENTITY } from "./types";

/** Tag commands (spec §4.4 tag manager). `tag` rows are hard-deleted — the table carries no
 *  `deleted_at`, and the manager's merge is the non-destructive path for a tag in use.
 *  The join-table helpers live in `./join` so the scene commands can share them. */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface TagRow {
  id: string;
  name: string;
  color: string;
}

async function requireTag(runner: SqlRunner, projectId: UUID, tagId: UUID): Promise<TagRow> {
  const rows = await runner.query<TagRow>(
    "SELECT id, name, color FROM tag WHERE id = ? AND project_id = ?",
    [tagId, projectId],
  );
  const row = rows[0];
  if (!row) throw new Error("tag not found");
  return row;
}

/** The other live tag already using this name, if any (case-insensitive, ASCII-folded). */
async function findTagByName(
  runner: SqlRunner,
  projectId: UUID,
  name: string,
  excludeId?: UUID,
): Promise<TagRow | null> {
  const rows = await runner.query<TagRow>(
    "SELECT id, name, color FROM tag WHERE project_id = ? AND name = ? COLLATE NOCASE",
    [projectId, name],
  );
  const match = rows.find((row) => row.id !== excludeId);
  return match ?? null;
}

function assertColor(color: string): string {
  if (!HEX_RE.test(color)) throw new Error("tag colour must be #RRGGBB");
  return color;
}

/**
 * Replaces one entity's tag set. Shared by the manager and the picker; the scene sheet's
 * name-based `setSceneTags` funnels through here too, so every target writes the join table
 * the same way.
 */
export interface CreateTagArgs {
  projectId: UUID;
  name: string;
  color?: string;
}

export const createTag: Command<CreateTagArgs, { tagId: UUID }> = {
  name: "tag.create",
  async run(ctx, args) {
    const name = normalizeTagName(args.name);
    if (name.length === 0) throw new Error("tag needs a name");
    if (await findTagByName(ctx.tx, args.projectId, name)) {
      throw new Error(`a tag called “${name}” already exists`);
    }
    const tagId = newUuid();
    await ctx.tx.query(
      "INSERT INTO tag (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)",
      [tagId, args.projectId, name, assertColor(args.color ?? tagColorFor(name)), epochNow()],
    );
    return {
      result: { tagId },
      changes: [{ table: "tag", op: "insert", id: tagId, parentIds: [args.projectId] }],
    };
  },
};

export interface RenameTagArgs {
  projectId: UUID;
  tagId: UUID;
  name: string;
}

export const renameTag: Command<RenameTagArgs, void> = {
  name: "tag.rename",
  async run(ctx, args) {
    const current = await requireTag(ctx.tx, args.projectId, args.tagId);
    const name = normalizeTagName(args.name);
    if (name.length === 0) throw new Error("tag needs a name");
    // A pure case change must not trip the unique index against itself.
    const clash = await findTagByName(ctx.tx, args.projectId, name, args.tagId);
    if (clash) throw new Error(`a tag called “${clash.name}” already exists`);
    if (name === current.name) return { result: undefined, changes: [] };
    await ctx.tx.query("UPDATE tag SET name = ? WHERE id = ?", [name, args.tagId]);
    return {
      result: undefined,
      changes: [{ table: "tag", op: "update", id: args.tagId, parentIds: [args.projectId] }],
    };
  },
};

export interface SetTagColorArgs {
  projectId: UUID;
  tagId: UUID;
  color: string;
}

export const setTagColor: Command<SetTagColorArgs, void> = {
  name: "tag.setColor",
  async run(ctx, args) {
    await requireTag(ctx.tx, args.projectId, args.tagId);
    await ctx.tx.query("UPDATE tag SET color = ? WHERE id = ?", [
      assertColor(args.color),
      args.tagId,
    ]);
    return {
      result: undefined,
      changes: [{ table: "tag", op: "update", id: args.tagId, parentIds: [args.projectId] }],
    };
  },
};

export interface DeleteTagArgs {
  projectId: UUID;
  tagId: UUID;
}

/** Hard delete; `entity_tag` rows cascade in the schema, and we report them as changes too so
 *  every cached list of chips refetches. */
export const deleteTag: Command<DeleteTagArgs, { detached: number }> = {
  name: "tag.delete",
  async run(ctx, args) {
    await requireTag(ctx.tx, args.projectId, args.tagId);
    const used = await ctx.tx.query<{ total: number }>(
      "SELECT COUNT(*) AS total FROM entity_tag WHERE tag_id = ?",
      [args.tagId],
    );
    await ctx.tx.query("DELETE FROM entity_tag WHERE tag_id = ?", [args.tagId]);
    await ctx.tx.query("DELETE FROM tag WHERE id = ?", [args.tagId]);
    return {
      result: { detached: Number(used[0]?.total ?? 0) },
      changes: [
        { table: "entity_tag", op: "delete", id: args.tagId, parentIds: [args.projectId] },
        { table: "tag", op: "delete", id: args.tagId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface MergeTagsArgs {
  projectId: UUID;
  /** The tag that disappears. */
  sourceTagId: UUID;
  /** The tag that keeps every attachment. */
  targetTagId: UUID;
}

/**
 * Merges two tags: every attachment of the source moves to the target (a row that already has
 * both keeps one) and the source row is removed. This is the destructive-but-recoverable path
 * the manager offers for a duplicate, so it must never lose an attachment.
 */
export const mergeTags: Command<MergeTagsArgs, { moved: number }> = {
  name: "tag.merge",
  async run(ctx, args) {
    if (args.sourceTagId === args.targetTagId) throw new Error("pick two different tags");
    await requireTag(ctx.tx, args.projectId, args.sourceTagId);
    await requireTag(ctx.tx, args.projectId, args.targetTagId);
    const rows = await ctx.tx.query<{ entity_type: string; entity_id: string }>(
      "SELECT entity_type, entity_id FROM entity_tag WHERE tag_id = ?",
      [args.sourceTagId],
    );
    let moved = 0;
    for (const row of rows) {
      await ctx.tx.query(
        "INSERT OR IGNORE INTO entity_tag (tag_id, entity_type, entity_id) VALUES (?, ?, ?)",
        [args.targetTagId, row.entity_type, row.entity_id],
      );
      moved += 1;
    }
    await ctx.tx.query("DELETE FROM entity_tag WHERE tag_id = ?", [args.sourceTagId]);
    await ctx.tx.query("DELETE FROM tag WHERE id = ?", [args.sourceTagId]);
    return {
      result: { moved },
      changes: [
        { table: "entity_tag", op: "update", id: args.targetTagId, parentIds: [args.projectId] },
        { table: "tag", op: "delete", id: args.sourceTagId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface SetEntityTagsArgs {
  projectId: UUID;
  entityType: EntityType;
  entityId: UUID;
  tagIds: UUID[];
}

export const setEntityTags: Command<SetEntityTagsArgs, void> = {
  name: "tag.setForEntity",
  async run(ctx, args) {
    if (!isTagTarget(args.entityType)) {
      throw new Error(`tags cannot be attached to ${args.entityType}`);
    }
    await assertTagTargetLive(ctx.tx, args.entityType, args.entityId, args.projectId);
    const changes = await replaceEntityTags(ctx.tx, args.entityType, args.entityId, args.tagIds);
    return { result: undefined, changes };
  },
};

/** Attaches one tag without touching the rest — the picker's optimistic single tap. */
export interface ToggleEntityTagArgs {
  projectId: UUID;
  entityType: EntityType;
  entityId: UUID;
  tagId: UUID;
  attach: boolean;
}

export const toggleEntityTag: Command<ToggleEntityTagArgs, void> = {
  name: "tag.toggleForEntity",
  async run(ctx, args) {
    if (!isTagTarget(args.entityType)) {
      throw new Error(`tags cannot be attached to ${args.entityType}`);
    }
    await assertTagTargetLive(ctx.tx, args.entityType, args.entityId, args.projectId);
    if (args.attach) {
      const count = await ctx.tx.query<{ total: number }>(
        "SELECT COUNT(*) AS total FROM entity_tag WHERE entity_type = ? AND entity_id = ?",
        [args.entityType, args.entityId],
      );
      if (Number(count[0]?.total ?? 0) >= TAG_MAX_PER_ENTITY) {
        throw new Error(`at most ${TAG_MAX_PER_ENTITY} tags per item`);
      }
      await ctx.tx.query(
        "INSERT OR IGNORE INTO entity_tag (tag_id, entity_type, entity_id) VALUES (?, ?, ?)",
        [args.tagId, args.entityType, args.entityId],
      );
    } else {
      await ctx.tx.query(
        "DELETE FROM entity_tag WHERE tag_id = ? AND entity_type = ? AND entity_id = ?",
        [args.tagId, args.entityType, args.entityId],
      );
    }
    return {
      result: undefined,
      changes: [
        {
          table: "entity_tag",
          op: "update",
          id: args.entityId,
          parentIds: [args.projectId],
        },
      ],
    };
  },
};

/** The tags of one entity, for the picker's checked state. */
export async function readEntityTagIds(
  runner: SqlRunner,
  entityType: EntityType,
  entityId: UUID,
): Promise<UUID[]> {
  const rows = await runner.query<{ tag_id: string }>(
    "SELECT tag_id FROM entity_tag WHERE entity_type = ? AND entity_id = ?",
    [entityType, entityId],
  );
  return rows.map((row) => row.tag_id as UUID);
}

export { requireTag as readTag };
