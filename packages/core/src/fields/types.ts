import type { CustomFieldTarget, CustomFieldType } from "../entities";
import type { OrderKey, UUID } from "../primitives";

/** Custom-field engine (spec §3.7 templates, §4.4 Fields screen). Slice 6 needs the storage +
 * validation for lore kind templates; slice 9 adds the settings UI, tags and the grid.
 * The `CustomFieldType` / `CustomFieldTarget` unions live in `entities.ts` (spec §3.1). */

export const FIELD_TYPES: readonly CustomFieldType[] = [
  "text",
  "longtext",
  "number",
  "date",
  "boolean",
  "select",
  "multiselect",
  "url",
  "color",
  "entity_ref",
];

export const FIELD_TARGETS: readonly CustomFieldTarget[] = [
  "character",
  "lore",
  "scene",
  "location",
];

export interface CustomFieldDef {
  id: UUID;
  projectId: UUID;
  target: CustomFieldTarget;
  /** Scopes the def to one lore kind (null = every kind). */
  loreKind: string | null;
  label: string;
  type: CustomFieldType;
  /** Choices for `select` / `multiselect`. */
  options: string[] | null;
  /** For `entity_ref`: which entity type the picker offers ("character", "lore", "any"). */
  entityRefTarget: string | null;
  required: boolean;
  orderKey: OrderKey;
  section: string;
}

export interface CustomFieldValueRow {
  defId: UUID;
  ownerType: string;
  ownerId: UUID;
  value: unknown;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Validates and normalises one field value for its definition. Returns the JSON string that
 * goes into `custom_field_value.value` (always valid JSON, per the schema CHECK).
 * Throws a human-readable error the forms can show verbatim.
 */
export function normalizeFieldValue(
  def: Pick<CustomFieldDef, "type" | "options" | "label">,
  value: unknown,
): string {
  const label = def.label || "field";
  switch (def.type) {
    case "text":
    case "longtext": {
      if (typeof value !== "string") throw new Error(`${label}: expected text`);
      return JSON.stringify(value);
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) throw new Error(`${label}: expected a number`);
      return JSON.stringify(n);
    }
    case "date": {
      if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
        throw new Error(`${label}: expected a YYYY-MM-DD date`);
      }
      return JSON.stringify(value);
    }
    case "boolean": {
      if (typeof value !== "boolean") throw new Error(`${label}: expected true/false`);
      return JSON.stringify(value);
    }
    case "select": {
      if (typeof value !== "string") throw new Error(`${label}: expected a choice`);
      const options = def.options ?? [];
      if (!options.includes(value)) throw new Error(`${label}: "${value}" is not an option`);
      return JSON.stringify(value);
    }
    case "multiselect": {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`${label}: expected a list of choices`);
      }
      const options = def.options ?? [];
      for (const item of value as string[]) {
        if (!options.includes(item)) throw new Error(`${label}: "${item}" is not an option`);
      }
      return JSON.stringify(value);
    }
    case "url": {
      if (typeof value !== "string") throw new Error(`${label}: expected a URL`);
      return JSON.stringify(value);
    }
    case "color": {
      if (typeof value !== "string" || !HEX_RE.test(value)) {
        throw new Error(`${label}: expected a #RRGGBB colour`);
      }
      return JSON.stringify(value);
    }
    case "entity_ref": {
      if (typeof value !== "string" || !UUID_RE.test(value)) {
        throw new Error(`${label}: expected an entity id`);
      }
      return JSON.stringify(value);
    }
    default: {
      const exhaustive: never = def.type;
      throw new Error(`unknown field type: ${String(exhaustive)}`);
    }
  }
}

/** Parses a stored JSON value; a corrupt cell reads as null instead of crashing the screen. */
export function parseFieldValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
