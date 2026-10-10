import type { UUID } from "../primitives";

/**
 * Snapshot model (spec §4.5.3). A snapshot is an immutable file next to the project; the
 * `snapshot_record` table is only a convenience index over those files, so every read here has
 * to survive the two drifting apart — the files are authoritative.
 */

export const SNAPSHOT_REASONS = [
  "open",
  "activity",
  "manual",
  "pre_migration",
  "pre_import",
  "pre_bulk_delete",
  "pre_restore",
] as const;

export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];

/**
 * Reasons that are never thinned by age: the writer asked for it, or it guards a destructive
 * operation they may want to walk back.
 */
export const SNAPSHOT_PINNED_REASONS: readonly SnapshotReason[] = [
  "manual",
  "pre_migration",
  "pre_import",
  "pre_bulk_delete",
  "pre_restore",
];

export function isPinnedReason(reason: string): boolean {
  return (SNAPSHOT_PINNED_REASONS as readonly string[]).includes(reason);
}

export function isSnapshotReason(value: string): value is SnapshotReason {
  return (SNAPSHOT_REASONS as readonly string[]).includes(value);
}

/** One snapshot file, as the file store sees it. */
export interface SnapshotFile {
  name: string;
  createdAt: number;
  byteSize: number;
  reason: SnapshotReason;
  /** Free-text label for a manual snapshot ("before the rewrite"). */
  label: string;
}

export interface RetentionPolicy {
  /** Keep every snapshot younger than this (spec: all from the last 24 h). */
  keepAllMs: number;
  /** Beyond that, keep the newest snapshot of each hour up to this age (spec: hourly, 7 days). */
  hourlyMs: number;
  /** Beyond that, keep the newest snapshot of each day up to this age (spec: daily, 60 days). */
  dailyMs: number;
  /** Hard cap on the bytes kept; oldest-first thinning that never touches the newest. */
  totalBytesCap: number;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_RETENTION: RetentionPolicy = {
  keepAllMs: DAY_MS,
  hourlyMs: 7 * DAY_MS,
  dailyMs: 60 * DAY_MS,
  totalBytesCap: 2 * 1024 * 1024 * 1024,
};

export interface RetentionPlan {
  keep: string[];
  remove: string[];
  keepBytes: number;
}

/** What one entity type looks like on each side of a diff. */
export interface SnapshotCounts {
  scenes: number;
  chapters: number;
  characters: number;
  loreEntries: number;
  notes: number;
  plotlines: number;
  words: number;
}

export type SnapshotCountKey = keyof SnapshotCounts;

export const SNAPSHOT_COUNT_KEYS: readonly SnapshotCountKey[] = [
  "scenes",
  "chapters",
  "characters",
  "loreEntries",
  "notes",
  "plotlines",
  "words",
];

export interface SnapshotDiff {
  current: SnapshotCounts;
  snapshot: SnapshotCounts;
  /** current − snapshot, per key: positive means the project gained that much since. */
  delta: SnapshotCounts;
  /** True when nothing the writer would notice changed. */
  identical: boolean;
}

/** A single row plus the join rows that travel with it, for "restore single entity". */
export interface ExtractedEntity {
  kind: RestorableKind;
  id: UUID;
  tables: Array<{
    table: string;
    columns: string[];
    rows: Array<Record<string, unknown>>;
    /** Rows the current database refused (missing FK target, schema drift). */
    skipped: number;
  }>;
}

export const RESTORABLE_KINDS = ["character", "scene", "lore_entry"] as const;
export type RestorableKind = (typeof RESTORABLE_KINDS)[number];

/** Join tables that belong to each restorable kind: [table, column holding the id]. */
export const RESTORABLE_JOINS: Record<RestorableKind, ReadonlyArray<readonly [string, string]>> = {
  character: [
    ["custom_field_value", "owner_id"],
    ["entity_tag", "entity_id"],
    ["scene_character", "character_id"],
    ["character_gallery", "character_id"],
    ["relationship", "source_id"],
    ["relationship", "target_id"],
  ],
  scene: [
    ["custom_field_value", "owner_id"],
    ["entity_tag", "entity_id"],
    ["scene_character", "scene_id"],
    ["scene_plotline", "scene_id"],
    ["scene_lore", "scene_id"],
  ],
  lore_entry: [
    ["custom_field_value", "owner_id"],
    ["entity_tag", "entity_id"],
  ],
};

/** Table each restorable kind lives in. */
export const RESTORABLE_TABLES: Record<RestorableKind, string> = {
  character: "character",
  scene: "scene",
  lore_entry: "lore_entry",
};

export function isRestorableKind(value: string): value is RestorableKind {
  return (RESTORABLE_KINDS as readonly string[]).includes(value);
}
