import type { EntityType } from "../entities";
import type { EpochMs, UUID } from "../primitives";

/** Entity types the Trash currently manages (spec §3.9; notes join when their slice lands). */
export const TRASH_ENTITY_TYPES = [
  "character",
  "scene",
  "chapter",
  "plotline",
  "lore_entry",
  "note",
] as const;
export type TrashEntityType = (typeof TRASH_ENTITY_TYPES)[number];

/** One row of the Trash screen (spec §3.9 `TrashItem`). */
export interface TrashItem {
  entityType: EntityType;
  entityId: UUID;
  deletedAt: EpochMs;
  label: string;
  /** Parent context for the row — e.g. a scene's chapter, so restores are recognisable. */
  detail: string;
}

/** Spec §5.3: soft-deleted rows are purged 30 days after deletion. */
export const TRASH_RETENTION_DAYS = 30;
