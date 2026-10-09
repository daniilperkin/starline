import type { UUID } from "../primitives";

/**
 * Search, backlinks and cross-reference reads (spec §3.9 `mention`, §3.10 FTS, §4.x panels,
 * PLAN slice 7). Everything here is a read over data other commands already maintain:
 * `search_fts`/`search_trigram` (trigger-maintained) and the `mention` mirror (written by
 * every rich-text save). Nothing in this module writes except the two mention-rewrite
 * commands, which go through the normal command/transaction path.
 */

export const SEARCH_ENTITY_TYPES = ["character", "lore", "scene", "chapter", "note"] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

/** Spec §5.1 budgets — the exit criterion for this slice, asserted by the perf suite. */
export const BACKLINK_BUDGET_MS = 10;
export const SEARCH_BUDGET_MS = 30;

export interface SearchHit {
  entityType: SearchEntityType;
  entityId: UUID;
  title: string;
  /** Plain-text window around the match (body), or the title when the title is what matched. */
  snippet: string;
  /** Lower is better (FTS5 bm25). */
  score: number;
  /** Type-specific context line: a scene's chapter, a lore entry's kind, a note's status. */
  detail: string;
  /** True when the hit came from the trigram (name) index rather than the token index. */
  fuzzy: boolean;
}

export interface SearchGroup {
  entityType: SearchEntityType;
  hits: SearchHit[];
}

export interface SearchResults {
  query: string;
  groups: SearchGroup[];
  total: number;
  tookMs: number;
}

/** One place that mentions a target: a source field plus how often and where. */
export interface BacklinkSource {
  sourceType: string;
  sourceId: UUID;
  field: string;
  count: number;
  title: string;
  detail: string;
  snippet: string;
}

export interface Backlinks {
  targetType: string;
  targetId: UUID;
  /** Distinct sources — what "Mentioned in N places" counts. */
  sources: BacklinkSource[];
  /** Sum of the per-field occurrence counts. */
  totalOccurrences: number;
  /** True when the target has more sources than the panel lists (`BACKLINK_MAX_SOURCES`). */
  truncated?: boolean;
}

/** A plain-text occurrence of a name that is not yet a mention chip. */
export interface PossibleMention {
  sourceType: string;
  sourceId: UUID;
  field: string;
  title: string;
  detail: string;
  occurrences: number;
  snippet: string;
}

export interface LinkMentionResult {
  /** Number of text ranges rewritten into mention nodes (0 = nothing to do). */
  linked: number;
}

export type CheckSeverity = "info" | "warning";

export interface CheckItem {
  entityType: string;
  entityId: UUID;
  title: string;
  detail: string;
}

export interface ConsistencyCheck {
  id: string;
  severity: CheckSeverity;
  label: string;
  hint: string;
  items: CheckItem[];
}
