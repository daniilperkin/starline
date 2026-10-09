import type { ChangeEvent } from "../changes";
import type { Command, SqlRunner } from "../commands";
import type { LoreKind } from "../entities";
import { ensureFieldDefs } from "../fields";
import { epochNow, newUuid, type OrderKey, orderKeyBetween, type UUID } from "../primitives";
import type { RichText } from "../richtext";
import { syncMentions } from "./mentions";
import {
  DEFAULT_LORE_TAXONOMY,
  LORE_ALIASES_MAX,
  LORE_KIND_TEMPLATES,
  LORE_KINDS,
  LORE_NAME_MAX,
  LORE_SUMMARY_MAX,
} from "./types";

/** Worldbuilding bible commands (spec §3.7). Cycles are refused before any write. */

const CATEGORY_NAME_MAX = 80;

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > LORE_NAME_MAX) {
    throw new Error(`entry name must be 1–${LORE_NAME_MAX} characters`);
  }
  return trimmed;
}

function validateAliases(aliases: string[] | undefined): string | null {
  if (aliases === undefined) return null;
  if (aliases.length > LORE_ALIASES_MAX) {
    throw new Error(`at most ${LORE_ALIASES_MAX} aliases`);
  }
  const cleaned = aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
  return JSON.stringify(cleaned);
}

/** True when `needleId` is `startId` or one of its ancestors in the given parent chain. */
async function chainContains(
  tx: SqlRunner,
  table: "lore_category" | "lore_entry",
  parentColumn: "parent_id" | "parent_entry_id",
  startId: UUID | null,
  needleId: UUID,
): Promise<boolean> {
  if (startId === null) return false;
  const rows = await tx.query<{ n: number }>(
    `WITH RECURSIVE chain(id, parent) AS (
       SELECT id, ${parentColumn} FROM ${table} WHERE id = ?
       UNION ALL
       SELECT t.id, t.${parentColumn} FROM ${table} t JOIN chain ON t.id = chain.parent
     )
     SELECT COUNT(*) AS n FROM chain WHERE id = ?`,
    [startId, needleId],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export interface SeedLoreTaxonomyArgs {
  projectId: UUID;
}

/** Creates the nine default categories once per project (idempotent — a second call is a no-op). */
export const seedLoreTaxonomy: Command<SeedLoreTaxonomyArgs, { created: number }> = {
  name: "lore.seedTaxonomy",
  async run(ctx, args) {
    const existing = await ctx.tx.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM lore_category WHERE project_id = ? AND deleted_at IS NULL",
      [args.projectId],
    );
    if (Number(existing[0]?.n ?? 0) > 0) return { result: { created: 0 }, changes: [] };
    const changes: ChangeEvent[] = [];
    const now = epochNow();
    let lastKey: OrderKey | null = null;
    for (const category of DEFAULT_LORE_TAXONOMY) {
      lastKey = orderKeyBetween(lastKey, null);
      const id = newUuid();
      await ctx.tx.query(
        `INSERT INTO lore_category
           (id, project_id, parent_id, name, icon, order_key, color, default_kind,
            created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
        [id, args.projectId, category.name, category.icon, lastKey, category.defaultKind, now, now],
      );
      changes.push({ table: "lore_category", op: "insert", id, parentIds: [args.projectId] });
    }
    return { result: { created: DEFAULT_LORE_TAXONOMY.length }, changes };
  },
};

export interface CreateLoreCategoryArgs {
  projectId: UUID;
  name: string;
  parentId?: UUID | null;
  icon?: string;
  color?: string | null;
  defaultKind?: LoreKind | null;
}

export const createLoreCategory: Command<CreateLoreCategoryArgs, { categoryId: UUID }> = {
  name: "lore.createCategory",
  async run(ctx, args) {
    const name = args.name.trim();
    if (name.length === 0 || name.length > CATEGORY_NAME_MAX) {
      throw new Error(`category name must be 1–${CATEGORY_NAME_MAX} characters`);
    }
    const parentId = args.parentId ?? null;
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM lore_category
        WHERE project_id = ? AND deleted_at IS NULL AND parent_id IS ?
        ORDER BY order_key DESC LIMIT 1`,
      [args.projectId, parentId],
    );
    const categoryId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO lore_category
         (id, project_id, parent_id, name, icon, order_key, color, default_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId,
        args.projectId,
        parentId,
        name,
        args.icon ?? "",
        orderKeyBetween(last[0]?.order_key ?? null, null),
        args.color ?? null,
        args.defaultKind ?? null,
        now,
        now,
      ],
    );
    return {
      result: { categoryId },
      changes: [
        { table: "lore_category", op: "insert", id: categoryId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface UpdateLoreCategoryArgs {
  projectId: UUID;
  categoryId: UUID;
  patch: { name?: string; icon?: string; color?: string | null; defaultKind?: LoreKind | null };
}

export const updateLoreCategory: Command<UpdateLoreCategoryArgs, void> = {
  name: "lore.updateCategory",
  async run(ctx, args) {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (args.patch.name !== undefined) {
      const name = args.patch.name.trim();
      if (name.length === 0 || name.length > CATEGORY_NAME_MAX) {
        throw new Error(`category name must be 1–${CATEGORY_NAME_MAX} characters`);
      }
      sets.push("name = ?");
      params.push(name);
    }
    if (args.patch.icon !== undefined) {
      sets.push("icon = ?");
      params.push(args.patch.icon);
    }
    if (args.patch.color !== undefined) {
      sets.push("color = ?");
      params.push(args.patch.color);
    }
    if (args.patch.defaultKind !== undefined) {
      sets.push("default_kind = ?");
      params.push(args.patch.defaultKind);
    }
    if (sets.length === 0) throw new Error("empty category patch");
    params.push(epochNow(), args.categoryId, args.projectId);
    await ctx.tx.query(
      `UPDATE lore_category SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    return {
      result: undefined,
      changes: [
        { table: "lore_category", op: "update", id: args.categoryId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface MoveLoreCategoryArgs {
  projectId: UUID;
  categoryId: UUID;
  parentId: UUID | null;
  orderKey: OrderKey;
}

export const moveLoreCategory: Command<MoveLoreCategoryArgs, void> = {
  name: "lore.moveCategory",
  async run(ctx, args) {
    if (args.parentId !== null) {
      if (args.parentId === args.categoryId) throw new Error("a category cannot contain itself");
      if (
        await chainContains(ctx.tx, "lore_category", "parent_id", args.parentId, args.categoryId)
      ) {
        throw new Error("that move would create a category cycle");
      }
    }
    await ctx.tx.query(
      `UPDATE lore_category SET parent_id = ?, order_key = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.parentId, args.orderKey, epochNow(), args.categoryId, args.projectId],
    );
    return {
      result: undefined,
      changes: [
        { table: "lore_category", op: "update", id: args.categoryId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface DeleteLoreCategoryArgs {
  projectId: UUID;
  categoryId: UUID;
  /** Required when the subtree still has entries (spec §3.12: deleting cascades). */
  cascade?: boolean;
}

export const deleteLoreCategory: Command<DeleteLoreCategoryArgs, { deletedEntries: number }> = {
  name: "lore.deleteCategory",
  async run(ctx, args) {
    const subtree = await ctx.tx.query<{ id: string }>(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM lore_category WHERE id = ? AND project_id = ?
         UNION ALL
         SELECT c.id FROM lore_category c JOIN sub ON c.parent_id = sub.id
       )
       SELECT id FROM sub`,
      [args.categoryId, args.projectId],
    );
    const ids = subtree.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const countRows = await ctx.tx.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM lore_entry
        WHERE project_id = ? AND deleted_at IS NULL AND category_id IN (${placeholders})`,
      [args.projectId, ...ids],
    );
    const entryCount = Number(countRows[0]?.n ?? 0);
    if (entryCount > 0 && !args.cascade) {
      throw new Error(`category still holds ${entryCount} entr${entryCount === 1 ? "y" : "ies"}`);
    }
    const now = epochNow();
    if (entryCount > 0) {
      await ctx.tx.query(
        `UPDATE lore_entry SET deleted_at = ?, updated_at = ?
          WHERE project_id = ? AND deleted_at IS NULL AND category_id IN (${placeholders})`,
        [now, now, args.projectId, ...ids],
      );
    }
    await ctx.tx.query(
      `UPDATE lore_category SET deleted_at = ?, updated_at = ?
        WHERE project_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
      [now, now, args.projectId, ...ids],
    );
    return {
      result: { deletedEntries: entryCount },
      changes: [
        { table: "lore_category", op: "delete", id: args.categoryId, parentIds: [args.projectId] },
        ...(entryCount > 0
          ? [
              {
                table: "lore_entry" as const,
                op: "delete" as const,
                id: ids[0] ?? args.categoryId,
                parentIds: [args.projectId],
              },
            ]
          : []),
      ],
    };
  },
};

export interface CreateLoreEntryArgs {
  projectId: UUID;
  name: string;
  kind: LoreKind;
  customKindLabel?: string;
  categoryId?: UUID | null;
  parentEntryId?: UUID | null;
}

export const createLoreEntry: Command<CreateLoreEntryArgs, { entryId: UUID }> = {
  name: "lore.createEntry",
  async run(ctx, args) {
    const name = validateName(args.name);
    if (!LORE_KINDS.includes(args.kind)) throw new Error(`unknown lore kind: ${args.kind}`);
    const customKindLabel = args.kind === "custom" ? (args.customKindLabel ?? "").trim() : "";
    if (args.kind === "custom" && customKindLabel.length === 0) {
      throw new Error("a custom kind needs a label");
    }
    const categoryId = args.categoryId ?? null;
    const parentEntryId = args.parentEntryId ?? null;
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM lore_entry
        WHERE project_id = ? AND deleted_at IS NULL AND category_id IS ? AND parent_entry_id IS ?
        ORDER BY order_key DESC LIMIT 1`,
      [args.projectId, categoryId, parentEntryId],
    );
    const entryId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO lore_entry
         (id, project_id, category_id, parent_entry_id, kind, custom_kind_label, name, aliases,
          summary, body_json, body_text, order_key, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '', NULL, '', ?, 0, ?, ?)`,
      [
        entryId,
        args.projectId,
        categoryId,
        parentEntryId,
        args.kind,
        customKindLabel,
        name,
        orderKeyBetween(last[0]?.order_key ?? null, null),
        now,
        now,
      ],
    );
    // Kind templates arrive with the first entry of that kind (spec §3.7, idempotent).
    await ensureFieldDefs(
      ctx.tx,
      args.projectId,
      "lore",
      args.kind,
      LORE_KIND_TEMPLATES[args.kind],
    );
    return {
      result: { entryId },
      changes: [{ table: "lore_entry", op: "insert", id: entryId, parentIds: [args.projectId] }],
    };
  },
};

export interface LoreEntryPatch {
  name?: string;
  kind?: LoreKind;
  customKindLabel?: string;
  aliases?: string[];
  summary?: string;
  body?: RichText;
  pinned?: boolean;
}

export interface UpdateLoreEntryArgs {
  projectId: UUID;
  entryId: UUID;
  patch: LoreEntryPatch;
}

export const updateLoreEntry: Command<UpdateLoreEntryArgs, void> = {
  name: "lore.updateEntry",
  async run(ctx, args) {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (args.patch.name !== undefined) {
      sets.push("name = ?");
      params.push(validateName(args.patch.name));
    }
    if (args.patch.summary !== undefined) {
      const summary = args.patch.summary.trim();
      if (summary.length > LORE_SUMMARY_MAX) {
        throw new Error(`summary must be at most ${LORE_SUMMARY_MAX} characters`);
      }
      sets.push("summary = ?");
      params.push(summary);
    }
    const aliases = validateAliases(args.patch.aliases);
    if (aliases !== null) {
      sets.push("aliases = ?");
      params.push(aliases);
    }
    if (args.patch.pinned !== undefined) {
      sets.push("pinned = ?");
      params.push(args.patch.pinned ? 1 : 0);
    }
    if (args.patch.kind !== undefined) {
      if (!LORE_KINDS.includes(args.patch.kind))
        throw new Error(`unknown lore kind: ${args.patch.kind}`);
      const customKindLabel =
        args.patch.kind === "custom" ? (args.patch.customKindLabel ?? "").trim() : "";
      if (args.patch.kind === "custom" && customKindLabel.length === 0) {
        throw new Error("a custom kind needs a label");
      }
      sets.push("kind = ?", "custom_kind_label = ?");
      params.push(args.patch.kind, customKindLabel);
      await ensureFieldDefs(
        ctx.tx,
        args.projectId,
        "lore",
        args.patch.kind,
        LORE_KIND_TEMPLATES[args.patch.kind],
      );
    }
    if (args.patch.body !== undefined) {
      sets.push("body_json = ?", "body_text = ?");
      params.push(
        args.patch.body.json === null ? null : JSON.stringify(args.patch.body.json),
        args.patch.body.text,
      );
    }
    if (sets.length === 0) throw new Error("empty lore patch");
    params.push(epochNow(), args.entryId, args.projectId);
    await ctx.tx.query(
      `UPDATE lore_entry SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    if (args.patch.body !== undefined) {
      await syncMentions(ctx.tx, "lore", args.entryId, "body", args.patch.body.json);
    }
    return {
      result: undefined,
      changes: [
        { table: "lore_entry", op: "update", id: args.entryId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface MoveLoreEntryArgs {
  projectId: UUID;
  entryId: UUID;
  categoryId: UUID | null;
  parentEntryId: UUID | null;
  orderKey: OrderKey;
}

export const moveLoreEntry: Command<MoveLoreEntryArgs, void> = {
  name: "lore.moveEntry",
  async run(ctx, args) {
    if (args.parentEntryId !== null) {
      if (args.parentEntryId === args.entryId) throw new Error("an entry cannot contain itself");
      if (
        await chainContains(
          ctx.tx,
          "lore_entry",
          "parent_entry_id",
          args.parentEntryId,
          args.entryId,
        )
      ) {
        throw new Error("that move would create an entry cycle");
      }
    }
    await ctx.tx.query(
      `UPDATE lore_entry SET category_id = ?, parent_entry_id = ?, order_key = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [
        args.categoryId,
        args.parentEntryId,
        args.orderKey,
        epochNow(),
        args.entryId,
        args.projectId,
      ],
    );
    return {
      result: undefined,
      changes: [
        { table: "lore_entry", op: "update", id: args.entryId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface DeleteLoreEntryArgs {
  projectId: UUID;
  entryId: UUID;
}

/** Soft delete; child entries move up to the deleted entry's parent instead of vanishing. */
export const deleteLoreEntry: Command<DeleteLoreEntryArgs, void> = {
  name: "lore.deleteEntry",
  async run(ctx, args) {
    const rows = await ctx.tx.query<{ parent_entry_id: string | null }>(
      "SELECT parent_entry_id FROM lore_entry WHERE id = ? AND project_id = ?",
      [args.entryId, args.projectId],
    );
    const parent = rows[0]?.parent_entry_id ?? null;
    const now = epochNow();
    await ctx.tx.query(
      "UPDATE lore_entry SET parent_entry_id = ?, updated_at = ? WHERE parent_entry_id = ?",
      [parent, now, args.entryId],
    );
    await ctx.tx.query(
      `UPDATE lore_entry SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.entryId, args.projectId],
    );
    return {
      result: undefined,
      changes: [
        { table: "lore_entry", op: "delete", id: args.entryId, parentIds: [args.projectId] },
      ],
    };
  },
};
