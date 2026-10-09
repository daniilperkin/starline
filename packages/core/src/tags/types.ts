import type { EntityType } from "../entities";
import type { UUID } from "../primitives";

/**
 * Tags (schema §3.5 `tag` + `entity_tag`, UX §4.4 tag manager). Slice 4 let the scene sheet
 * type tag names; slice 9 adds the manager, the shared picker, counts and merging.
 *
 * `entity_tag` is polymorphic and has no FK, so this list is a product decision rather than a
 * schema one: it is exactly the set of entities the app renders a chip on today.
 */
export const TAG_TARGETS: readonly EntityType[] = [
  "character",
  "scene",
  "chapter",
  "plotline",
  "lore_entry",
];

/** Table per target, for the liveness check before attaching (names match 1:1 by convention). */
export const TAG_TARGET_TABLES: Record<string, string> = {
  character: "character",
  scene: "scene",
  chapter: "chapter",
  plotline: "plotline",
  lore_entry: "lore_entry",
};

export const TAG_NAME_MAX = 60;
/** Matches the slice-4 scene tag cap; keeps one entity's chip row readable on a phone. */
export const TAG_MAX_PER_ENTITY = 20;

export interface TagSummary {
  id: UUID;
  name: string;
  color: string;
  /** Live attachments across every target. 0 for a chip list, real numbers in the manager. */
  count: number;
}

export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, TAG_NAME_MAX);
}

/**
 * The uniqueness key. The schema's UNIQUE(project_id, name) uses `COLLATE NOCASE`, which is
 * ASCII-only — so this mirrors it rather than using `toLocaleLowerCase`, which would fold
 * characters the index does not.
 */
export function tagNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function isTagTarget(value: string): value is EntityType {
  return TAG_TARGETS.includes(value as EntityType);
}
