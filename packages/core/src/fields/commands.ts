import type { Command, SqlRunner } from "../commands";
import type { CustomFieldTarget, CustomFieldType } from "../entities";
import { epochNow, newUuid, orderKeyBetween, type UUID } from "../primitives";
import { type CustomFieldDef, FIELD_TARGETS, FIELD_TYPES, normalizeFieldValue } from "./types";

/** Custom-field definitions and values (spec §4.4). One def = one row; values are JSON. */

export interface CreateFieldDefArgs {
  projectId: UUID;
  target: CustomFieldTarget;
  loreKind?: string | null;
  label: string;
  type: CustomFieldType;
  options?: string[] | null;
  entityRefTarget?: string | null;
  required?: boolean;
  section?: string;
}

export const createFieldDef: Command<CreateFieldDefArgs, { defId: UUID }> = {
  name: "field.create",
  async run(ctx, args) {
    const label = args.label.trim();
    if (label.length === 0 || label.length > 60) {
      throw new Error("field label must be 1–60 characters");
    }
    if (!FIELD_TARGETS.includes(args.target)) throw new Error(`unknown target: ${args.target}`);
    if (!FIELD_TYPES.includes(args.type)) throw new Error(`unknown field type: ${args.type}`);
    if ((args.type === "select" || args.type === "multiselect") && !args.options?.length) {
      throw new Error(`${label}: select fields need at least one option`);
    }
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM custom_field_def
        WHERE project_id = ? AND target = ? AND deleted_at IS NULL
          AND (lore_kind IS ? OR (lore_kind IS NULL AND ? IS NULL))
        ORDER BY order_key DESC LIMIT 1`,
      [args.projectId, args.target, args.loreKind ?? null, args.loreKind ?? null],
    );
    const defId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO custom_field_def
         (id, project_id, target, lore_kind, label, type, options, entity_ref_target,
          required, order_key, section, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        defId,
        args.projectId,
        args.target,
        args.loreKind ?? null,
        label,
        args.type,
        args.options?.length ? JSON.stringify(args.options) : null,
        args.entityRefTarget ?? null,
        args.required ? 1 : 0,
        orderKeyBetween(last[0]?.order_key ?? null, null),
        args.section ?? "",
        now,
        now,
      ],
    );
    return {
      result: { defId },
      changes: [
        { table: "custom_field_def", op: "insert", id: defId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface UpdateFieldDefArgs {
  projectId: UUID;
  defId: UUID;
  patch: { label?: string; options?: string[] | null; required?: boolean; section?: string };
}

export const updateFieldDef: Command<UpdateFieldDefArgs, void> = {
  name: "field.update",
  async run(ctx, args) {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (args.patch.label !== undefined) {
      const label = args.patch.label.trim();
      if (label.length === 0 || label.length > 60) {
        throw new Error("field label must be 1–60 characters");
      }
      sets.push("label = ?");
      params.push(label);
    }
    if (args.patch.options !== undefined) {
      sets.push("options = ?");
      params.push(args.patch.options?.length ? JSON.stringify(args.patch.options) : null);
    }
    if (args.patch.required !== undefined) {
      sets.push("required = ?");
      params.push(args.patch.required ? 1 : 0);
    }
    if (args.patch.section !== undefined) {
      sets.push("section = ?");
      params.push(args.patch.section);
    }
    if (sets.length === 0) throw new Error("empty field patch");
    params.push(epochNow(), args.defId, args.projectId);
    await ctx.tx.query(
      `UPDATE custom_field_def SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    return {
      result: undefined,
      changes: [
        { table: "custom_field_def", op: "update", id: args.defId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface DeleteFieldDefArgs {
  projectId: UUID;
  defId: UUID;
}

/** Soft delete; values stay (they come back if the def is restored). */
export const deleteFieldDef: Command<DeleteFieldDefArgs, void> = {
  name: "field.delete",
  async run(ctx, args) {
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE custom_field_def SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.defId, args.projectId],
    );
    return {
      result: undefined,
      changes: [
        { table: "custom_field_def", op: "delete", id: args.defId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface SetFieldValueArgs {
  defId: UUID;
  ownerType: string;
  ownerId: UUID;
  value: unknown;
}

/** Upsert one value, validated against its definition (spec §4.4 per-type validation). */
export const setFieldValue: Command<SetFieldValueArgs, void> = {
  name: "field.setValue",
  async run(ctx, args) {
    const rows = await ctx.tx.query<{ label: string; type: string; options: string | null }>(
      "SELECT label, type, options FROM custom_field_def WHERE id = ? AND deleted_at IS NULL",
      [args.defId],
    );
    const def = rows[0];
    if (!def) throw new Error(`unknown field definition: ${args.defId}`);
    const encoded = normalizeFieldValue(
      {
        label: def.label,
        type: def.type as CustomFieldType,
        options: def.options ? (JSON.parse(def.options) as string[]) : null,
      },
      args.value,
    );
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO custom_field_value (id, def_id, owner_type, owner_id, value, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (def_id, owner_type, owner_id)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [newUuid(), args.defId, args.ownerType, args.ownerId, encoded, now],
    );
    return {
      result: undefined,
      changes: [
        { table: "custom_field_value", op: "update", id: args.ownerId, parentIds: [args.ownerId] },
      ],
    };
  },
};

export interface ClearFieldValueArgs {
  defId: UUID;
  ownerType: string;
  ownerId: UUID;
}

export const clearFieldValue: Command<ClearFieldValueArgs, void> = {
  name: "field.clearValue",
  async run(ctx, args) {
    await ctx.tx.query(
      "DELETE FROM custom_field_value WHERE def_id = ? AND owner_type = ? AND owner_id = ?",
      [args.defId, args.ownerType, args.ownerId],
    );
    return {
      result: undefined,
      changes: [
        { table: "custom_field_value", op: "delete", id: args.ownerId, parentIds: [args.ownerId] },
      ],
    };
  },
};

/**
 * Seeds the definitions of one template set for a scope, idempotently: a template whose label
 * already exists in that scope is skipped (so user edits to labels are never overwritten).
 * Returns the number of defs created.
 */
export async function ensureFieldDefs(
  tx: SqlRunner,
  projectId: UUID,
  target: CustomFieldTarget,
  loreKind: string | null,
  templates: readonly {
    label: string;
    type: CustomFieldType;
    options?: readonly string[];
    entityRefTarget?: string;
    section?: string;
  }[],
): Promise<number> {
  const existing = await tx.query<{ label: string; order_key: string }>(
    `SELECT label, order_key FROM custom_field_def
      WHERE project_id = ? AND target = ? AND deleted_at IS NULL
        AND (lore_kind IS ? OR (lore_kind IS NULL AND ? IS NULL))
      ORDER BY order_key`,
    [projectId, target, loreKind, loreKind],
  );
  const known = new Set(existing.map((row) => row.label.toLowerCase()));
  let lastKey: string | null = existing[existing.length - 1]?.order_key ?? null;
  let created = 0;
  const now = epochNow();
  for (const template of templates) {
    if (known.has(template.label.toLowerCase())) continue;
    lastKey = orderKeyBetween(lastKey, null);
    await tx.query(
      `INSERT INTO custom_field_def
         (id, project_id, target, lore_kind, label, type, options, entity_ref_target,
          required, order_key, section, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        newUuid(),
        projectId,
        target,
        loreKind,
        template.label,
        template.type,
        template.options?.length ? JSON.stringify(template.options) : null,
        template.entityRefTarget ?? null,
        lastKey,
        template.section ?? "",
        now,
        now,
      ],
    );
    created += 1;
  }
  return created;
}

/** Re-export for callers that only need the shape. */
export type { CustomFieldDef };
