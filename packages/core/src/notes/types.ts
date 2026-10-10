import type { EntityType } from "../entities";
import type { EpochMs, OrderKey, UUID } from "../primitives";
import type { RichText } from "../richtext";

/**
 * The notes incubator (spec §4.4.2, PLAN slice 14). A note is a thought with a lifecycle —
 * Inbox → Incubating → Used → Archived — that can be promoted into a real entity, leaving a
 * link behind. Everything here is the shape of that row; the commands and reads live next door.
 */

export const NOTE_KINDS = [
  "idea",
  "research",
  "dialogue",
  "scene_seed",
  "question",
  "todo",
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const NOTE_STATUSES = ["inbox", "incubating", "used", "archived"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** Star-library hues, one per column, used by the board headers and the kind chips. */
export const NOTE_STATUS_COLORS: Record<NoteStatus, string> = {
  inbox: "#8b5cf6",
  incubating: "#f59e0b",
  used: "#22c55e",
  archived: "#64748b",
};

export const NOTE_KIND_GLYPHS: Record<NoteKind, string> = {
  idea: "✦",
  research: "⌕",
  dialogue: "❝",
  scene_seed: "▤",
  question: "?",
  todo: "☐",
};

/** "Incubating untouched for longer than this" = the dashboard nudge (spec §4.4.2). */
export const NOTE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
export const NOTE_TITLE_MAX = 200;

export interface NoteDraft {
  title: string;
  kind: NoteKind;
  status: NoteStatus;
  body: RichText;
  /** Stored as text; the app never fetches it (spec §4.4.2) — the system browser opens it. */
  sourceUrl: string;
  pinned: boolean;
  color: string | null;
}

export interface NoteSummary extends NoteDraft {
  id: UUID;
  projectId: UUID;
  orderKey: OrderKey;
  promotedToType: EntityType | null;
  promotedToId: UUID | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** What a note can be promoted into (spec §4.4.2). */
export const PROMOTE_TARGETS = ["scene", "character", "lore", "plotline"] as const;
export type PromoteTarget = (typeof PROMOTE_TARGETS)[number];

/** One row of the dashboard's "Revisit these ideas" card. */
export interface StaleIdea {
  id: UUID;
  title: string;
  kind: NoteKind;
  updatedAt: EpochMs;
  ageDays: number;
}
