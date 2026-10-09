import type { UUID } from "../primitives";
import type { RelationshipCharacter, RelationshipEdge } from "./types";

/** Sorted pair key so a cell is the same object read from either axis. */
export function matrixCellKey(firstId: UUID, secondId: UUID): string {
  return firstId <= secondId ? `${firstId}|${secondId}` : `${secondId}|${firstId}`;
}

export interface MatrixCell {
  /** Every live edge of the pair, strongest feeling first. */
  edges: RelationshipEdge[];
  /** The edge the cell renders (highest |sentiment|; ties keep the oldest). */
  primary: RelationshipEdge;
  kinds: string[];
  count: number;
  secret: boolean;
  directed: boolean;
  sentiment: number;
}

/**
 * The N×N matrix data (spec §4.2.3): one entry per connected pair, symmetric by construction —
 * an undirected edge is stored once (source < target) and a directed one is placed on both
 * axes, so reading the matrix never depends on which way the writer drew the arrow.
 */
export function buildMatrixCells(edges: readonly RelationshipEdge[]): Map<string, MatrixCell> {
  const byPair = new Map<string, RelationshipEdge[]>();
  for (const edge of edges) {
    const key = matrixCellKey(edge.sourceId, edge.targetId);
    const list = byPair.get(key);
    if (list) list.push(edge);
    else byPair.set(key, [edge]);
  }
  const cells = new Map<string, MatrixCell>();
  for (const [key, list] of byPair) {
    const sorted = [...list].sort((a, b) => {
      const delta = Math.abs(b.sentiment) - Math.abs(a.sentiment);
      return delta !== 0 ? delta : a.updatedAt - b.updatedAt;
    });
    const primary = sorted[0];
    if (!primary) continue;
    cells.set(key, {
      edges: sorted,
      primary,
      kinds: [...new Set(sorted.map((edge) => edge.kind))],
      count: sorted.length,
      secret: sorted.some((edge) => edge.secret),
      directed: sorted.some((edge) => edge.directed),
      sentiment: primary.sentiment,
    });
  }
  return cells;
}

export interface GraphFilterOptions {
  /** Kind whitelist (empty = every kind). */
  kinds?: readonly string[];
  /** Keep only edges in this group. */
  groupId?: UUID | null;
  /** Minimum |sentiment| (0 = no filter). */
  minAbsSentiment?: number;
  /** Drop `minor` and `mentioned` characters (they are usually set dressing). */
  hideMinor?: boolean;
  /** "As of scene…" (spec §4.2.3): scene order + the chosen scene. */
  asOf?: { atSceneId: UUID; order: ReadonlyMap<UUID, number> } | null;
}

/**
 * Edge filter for the graph toolbar. The "as of scene" rule reads edge lifetimes against the
 * outliner's scene order: an edge is visible at scene S when it starts at or before S and does
 * not end before S (a null bound is open-ended).
 */
export function filterRelationships(
  edges: readonly RelationshipEdge[],
  characters: readonly RelationshipCharacter[],
  options: GraphFilterOptions = {},
): RelationshipEdge[] {
  const roles = new Map(characters.map((character) => [character.id, character.role]));
  const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  const minAbs = options.minAbsSentiment ?? 0;
  const asOf = options.asOf ?? null;
  const at = asOf ? asOf.order.get(asOf.atSceneId) : undefined;
  return edges.filter((edge) => {
    if (kinds && !kinds.has(edge.kind)) return false;
    if (
      options.groupId !== undefined &&
      options.groupId !== null &&
      edge.groupId !== options.groupId
    ) {
      return false;
    }
    if (minAbs > 0 && Math.abs(edge.sentiment) < minAbs) return false;
    if (options.hideMinor) {
      const sourceRole = roles.get(edge.sourceId);
      const targetRole = roles.get(edge.targetId);
      if (sourceRole === "minor" || sourceRole === "mentioned") return false;
      if (targetRole === "minor" || targetRole === "mentioned") return false;
    }
    if (asOf && at !== undefined) {
      const starts = edge.startsAtSceneId ? asOf.order.get(edge.startsAtSceneId) : undefined;
      const ends = edge.endsAtSceneId ? asOf.order.get(edge.endsAtSceneId) : undefined;
      if (starts !== undefined && starts > at) return false;
      if (ends !== undefined && ends < at) return false;
    }
    return true;
  });
}

/** Characters that still carry an edge after filtering (the graph's node set). */
export function graphCharacters(
  characters: readonly RelationshipCharacter[],
  edges: readonly RelationshipEdge[],
): RelationshipCharacter[] {
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.sourceId);
    connected.add(edge.targetId);
  }
  return characters.filter((character) => connected.has(character.id));
}

/** RFC-4180-ish quoting: wrap when the value carries a comma, quote or newline. */
function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The matrix/graph CSV (spec §4.3.5 `relationships.csv` column list): one row per live edge,
 * character names resolved, group name resolved. Pure so the export button is testable without
 * a DOM.
 */
export function relationshipsToCsv(
  edges: readonly RelationshipEdge[],
  characters: readonly RelationshipCharacter[],
  groups: readonly { id: string; name: string }[] = [],
): string {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const header = [
    "source",
    "target",
    "kind",
    "customLabel",
    "directed",
    "sentiment",
    "secret",
    "group",
    "startsAtScene",
    "endsAtScene",
    "notes",
  ].join(",");
  const rows = edges.map((edge) =>
    [
      names.get(edge.sourceId) ?? edge.sourceId,
      names.get(edge.targetId) ?? edge.targetId,
      edge.kind,
      edge.customLabel,
      edge.directed,
      edge.sentiment,
      edge.secret,
      edge.groupId ? (groupNames.get(edge.groupId) ?? edge.groupId) : "",
      edge.startsAtSceneId ?? "",
      edge.endsAtSceneId ?? "",
      edge.notes.text.replace(/\s+/g, " ").trim(),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

/**
 * Characters ordered for the matrix axes (spec §4.2.3 "column grouping in matrix"): characters
 * whose edges belong to the same RelationshipGroup sit next to each other, so a clustered story
 * reads as blocks along the diagonal. Inside a group the manual order is kept.
 */
export function orderCharactersByGroup(
  characters: readonly RelationshipCharacter[],
  edges: readonly RelationshipEdge[],
  groups: readonly { id: string; orderKey: string }[] = [],
): RelationshipCharacter[] {
  const groupOrder = new Map(
    groups.map((group, index) => [group.id, `${group.orderKey}:${index}`]),
  );
  const firstGroup = new Map<string, string>();
  for (const edge of edges) {
    if (!edge.groupId) continue;
    const key = groupOrder.get(edge.groupId) ?? edge.groupId;
    for (const characterId of [edge.sourceId, edge.targetId]) {
      const current = firstGroup.get(characterId);
      if (current === undefined || key < current) firstGroup.set(characterId, key);
    }
  }
  return [...characters].sort((a, b) => {
    const aKey = firstGroup.get(a.id) ?? "\uffff";
    const bKey = firstGroup.get(b.id) ?? "\uffff";
    return aKey === bKey ? 0 : aKey < bKey ? -1 : 1;
  });
}
