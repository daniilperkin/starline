import type { RelationshipKind } from "../entities";
import type { EpochMs, UUID } from "../primitives";
import type { RichText } from "../richtext";

/** All 18 kinds, in the order the schema CHECK constraint lists them (spec §3.5). */
export const RELATIONSHIP_KINDS: readonly RelationshipKind[] = [
  "family_parent",
  "family_child",
  "family_sibling",
  "family_spouse",
  "family_other",
  "romantic",
  "friend",
  "ally",
  "rival",
  "enemy",
  "mentor",
  "mentee",
  "employer",
  "employee",
  "servant",
  "master",
  "acquaintance",
  "custom",
] as const;

/**
 * Matrix-cell glyph per kind (spec §4.2.3: the cell shows "the kind glyph + sentiment colour").
 * Deliberately one character from the BMP geometric-shapes/misc-symbols blocks — every one
 * renders in the Android WebView, the desktop browsers and the terminal-grade fonts alike — and
 * the accessible name always spells the kind out, so the glyph never carries meaning alone.
 */
export const RELATIONSHIP_KIND_GLYPHS: Record<RelationshipKind, string> = {
  family_parent: "▲",
  family_child: "▼",
  family_sibling: "◀",
  family_spouse: "♥",
  family_other: "◇",
  romantic: "♡",
  friend: "●",
  ally: "◐",
  rival: "≠",
  enemy: "✕",
  mentor: "★",
  mentee: "☆",
  employer: "■",
  employee: "□",
  servant: "▽",
  master: "△",
  acquaintance: "○",
  custom: "◆",
};

/**
 * Kinds that mean the same thing read from either end, so a new edge of that kind defaults to
 * `directed: false` (spec §3.5: "false → symmetric (friend); true → source→target (mentor)").
 * Everything else — parent/child, mentor/mentee, employer/employee, servant/master — reads from
 * the source's point of view and defaults to directed.
 */
export const SYMMETRIC_RELATIONSHIP_KINDS: readonly RelationshipKind[] = [
  "family_sibling",
  "family_spouse",
  "family_other",
  "romantic",
  "friend",
  "ally",
  "rival",
  "enemy",
  "acquaintance",
];

export function defaultDirected(kind: RelationshipKind): boolean {
  return !SYMMETRIC_RELATIONSHIP_KINDS.includes(kind);
}

export const MIN_SENTIMENT = -5;
export const MAX_SENTIMENT = 5;

export function clampSentiment(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(MIN_SENTIMENT, Math.min(MAX_SENTIMENT, Math.round(value)));
}

/** Sentiment endpoints of the matrix/graph gradient (spec §4.2.3: red ↔ grey ↔ green). */
const SENTIMENT_HOSTILE = { r: 0xf8, g: 0x71, b: 0x71 };
const SENTIMENT_NEUTRAL = { r: 0x9a, g: 0xa0, b: 0xc0 };
const SENTIMENT_WARM = { r: 0x5a, g: 0xd1, b: 0xa5 };

function mix(from: typeof SENTIMENT_HOSTILE, to: typeof SENTIMENT_NEUTRAL, t: number): string {
  const channel = (a: number, b: number) => Math.round(a + (b - a) * t);
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(channel(from.r, to.r))}${hex(channel(from.g, to.g))}${hex(channel(from.b, to.b))}`;
}

/** A hex colour for any sentiment from -5 (hostile) through 0 (neutral) to +5 (warm). */
export function sentimentColor(sentiment: number): string {
  const value = clampSentiment(sentiment);
  if (value === 0) return mix(SENTIMENT_HOSTILE, SENTIMENT_NEUTRAL, 1);
  if (value < 0) return mix(SENTIMENT_HOSTILE, SENTIMENT_NEUTRAL, (value + 5) / 5);
  return mix(SENTIMENT_NEUTRAL, SENTIMENT_WARM, value / 5);
}

/**
 * Undirected edges are stored with `source_id < target_id` (spec §3.5: the unique index keys on
 * the pair, so an undirected "friend" edge written from either side must land on one row).
 * Directed edges keep the direction the writer drew — source acts on target.
 */
export function normalizeEdgePair(
  sourceId: UUID,
  targetId: UUID,
  directed: boolean,
): { sourceId: UUID; targetId: UUID } {
  if (directed || sourceId <= targetId) return { sourceId, targetId };
  return { sourceId: targetId, targetId: sourceId };
}

/** A stored edge with parsed JSON columns. */
export interface RelationshipEdge {
  id: UUID;
  projectId: UUID;
  sourceId: UUID;
  targetId: UUID;
  kind: RelationshipKind;
  customLabel: string;
  directed: boolean;
  sentiment: number;
  notes: RichText;
  groupId: UUID | null;
  startsAtSceneId: UUID | null;
  endsAtSceneId: UUID | null;
  secret: boolean;
  updatedAt: EpochMs;
}

export interface RelationshipGroupSummary {
  id: UUID;
  projectId: UUID;
  name: string;
  color: string;
  orderKey: string;
}

/** The character slice the matrix and the graph need (no dossier payload). */
export interface RelationshipCharacter {
  id: UUID;
  name: string;
  color: string;
  role: string;
}

export interface RelationshipDraft {
  sourceId: UUID;
  targetId: UUID;
  kind: RelationshipKind;
  customLabel?: string;
  directed?: boolean;
  sentiment?: number;
  groupId?: UUID | null;
  startsAtSceneId?: UUID | null;
  endsAtSceneId?: UUID | null;
  secret?: boolean;
  notes?: RichText;
}

export interface RelationshipPatch {
  kind?: RelationshipKind;
  customLabel?: string;
  directed?: boolean;
  sentiment?: number;
  notes?: RichText;
  groupId?: UUID | null;
  startsAtSceneId?: UUID | null;
  endsAtSceneId?: UUID | null;
  secret?: boolean;
}

/** One read for the whole relationship surface: characters, edges, groups (spec §4.2.3). */
export interface RelationshipMatrix {
  characters: RelationshipCharacter[];
  edges: RelationshipEdge[];
  groups: RelationshipGroupSummary[];
}

/** Manual node pinning, stored under the `graph_positions` meta key (spec §4.2.3). */
export type GraphPositions = Record<string, { x: number; y: number }>;

/** Group swatches for the group manager (star-library palette, same family as role colours). */
export const RELATIONSHIP_GROUP_SWATCHES: readonly string[] = [
  "#f6c760",
  "#8b7cf6",
  "#5ad1a5",
  "#e879b9",
  "#6ea8fe",
  "#f87171",
  "#9aa0c0",
];
