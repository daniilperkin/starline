import type { SqlValue } from "../commands";
import type { CustomFieldTarget, CustomFieldType } from "../entities";
import type { UUID } from "../primitives";
import { type CustomFieldDef, parseFieldValue } from "./types";

/** The read-only statement surface a storage driver satisfies for queries. */
export interface FieldQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/** Field definitions for one target (and lore kind, when scoped), in manual order. */
export async function listFieldDefs(
  runner: FieldQueryRunner,
  projectId: UUID,
  target: CustomFieldTarget,
  loreKind?: string | null,
): Promise<CustomFieldDef[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    target: string;
    lore_kind: string | null;
    label: string;
    type: string;
    options: string | null;
    entity_ref_target: string | null;
    required: number;
    order_key: string;
    section: string;
  }>(
    `SELECT id, project_id, target, lore_kind, label, type, options, entity_ref_target,
            required, order_key, section
       FROM custom_field_def
      WHERE project_id = ? AND target = ? AND deleted_at IS NULL
        AND (lore_kind IS ? OR lore_kind IS NULL)
      ORDER BY order_key`,
    [projectId, target, loreKind ?? null],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    target: row.target as CustomFieldTarget,
    loreKind: row.lore_kind,
    label: row.label,
    type: row.type as CustomFieldType,
    options: row.options ? (JSON.parse(row.options) as string[]) : null,
    entityRefTarget: row.entity_ref_target,
    required: row.required === 1,
    orderKey: row.order_key,
    section: row.section,
  }));
}

/** Values of one owner, keyed by definition id. */
export async function listFieldValues(
  runner: FieldQueryRunner,
  ownerType: string,
  ownerId: UUID,
): Promise<Map<string, unknown>> {
  const rows = await runner.query<{ def_id: string; value: string }>(
    "SELECT def_id, value FROM custom_field_value WHERE owner_type = ? AND owner_id = ?",
    [ownerType, ownerId],
  );
  const values = new Map<string, unknown>();
  for (const row of rows) values.set(row.def_id, parseFieldValue(row.value));
  return values;
}
