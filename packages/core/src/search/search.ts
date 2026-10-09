import type { SqlValue } from "../commands";
import type { UUID } from "../primitives";
import { headSnippet, toFtsQuery, toTrigramQuery } from "./text";
import type { SearchEntityType, SearchGroup, SearchHit, SearchResults } from "./types";

/**
 * Global search (spec §3.10 + §4.x, PLAN slice 7). Two passes over the trigger-maintained
 * indexes: the token index (`search_fts`, unicode61 + prefix) for full text, and the trigram
 * index (`search_trigram`, title only) so a misspelled or partial name still resolves — that
 * pass is what makes search feel forgiving on a phone keyboard.
 *
 * Both passes are ONE round trip each (all five entity types as UNION ALL branches, each a
 * subquery so it can keep its own `ORDER BY rank LIMIT n`), and the context lines are a third:
 * the storage round trip and the JSON payload dominate the cost of this read, not the SQL.
 * Every branch joins its source table to filter by project and to skip soft-deleted rows — the
 * FTS tables carry no project column, and one library file may hold several books.
 *
 * Budget: spec §5.1 wants search ≤ 30 ms; slice 7 asserts it in the perf suite.
 */

export interface SearchRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

interface Branch {
  entityType: SearchEntityType;
  table: string;
}

const BRANCHES: readonly Branch[] = [
  { entityType: "character", table: "character" },
  { entityType: "lore", table: "lore_entry" },
  { entityType: "scene", table: "scene" },
  { entityType: "chapter", table: "chapter" },
  { entityType: "note", table: "idea_note" },
];

const DETAIL_SELECT: Record<string, string> = {
  character: "t.role",
  lore: "CASE WHEN t.kind = 'custom' THEN t.custom_kind_label ELSE replace(t.kind, '_', ' ') END",
  scene: "COALESCE(c.title, p.title, '')",
  chapter: "COALESCE(p.title, '')",
  note: "t.status",
};

const DETAIL_JOINS: Record<string, string> = {
  scene: "LEFT JOIN chapter c ON c.id = t.chapter_id LEFT JOIN part p ON p.id = c.part_id",
  chapter: "LEFT JOIN part p ON p.id = t.part_id",
};

/** High-resolution timing when the host has it (Node and browsers do), ms otherwise. */
const perf = (globalThis as { performance?: { now(): number } }).performance;

function now(): number {
  return perf ? perf.now() : Date.now();
}

interface RawHit {
  entity_type: string;
  entity_id: string;
  title: string;
  body_snippet: string | null;
  score: number;
}

/** One indexed pass over all five types, in a single round trip. */
async function runPass(
  runner: SearchRunner,
  projectId: UUID,
  match: string,
  limit: number,
  trigram: boolean,
): Promise<SearchHit[]> {
  const params: SqlValue[] = [];
  const branches = BRANCHES.map((branch) => {
    const index = trigram ? "search_trigram" : "search_fts";
    const snippet = trigram ? "NULL" : "snippet(search_fts, 3, '', '', ' … ', 12)";
    params.push(branch.entityType, match, projectId, limit);
    return `SELECT * FROM (
      SELECT f.entity_type AS entity_type, f.entity_id AS entity_id, f.title AS title,
             ${snippet} AS body_snippet, bm25(${index}) AS score
        FROM ${index} f
        JOIN ${branch.table} t ON t.id = f.entity_id
       WHERE f.entity_type = ? AND ${index} MATCH ? AND t.project_id = ? AND t.deleted_at IS NULL
       ORDER BY score LIMIT ?
    )`;
  });
  const rows = await runner.query<RawHit>(branches.join("\nUNION ALL\n"), params);
  return rows.map((row) => ({
    entityType: row.entity_type as SearchEntityType,
    entityId: row.entity_id as UUID,
    title: row.title ?? "",
    snippet: headSnippet(row.body_snippet ?? ""),
    score: Number(row.score ?? 0),
    detail: "",
    fuzzy: trigram,
  }));
}

/** Resolves the context line for the hits that survived ranking — one round trip. */
async function resolveDetails(
  runner: SearchRunner,
  projectId: UUID,
  hits: SearchHit[],
): Promise<void> {
  if (hits.length === 0) return;
  const idsByType = new Map<string, string[]>();
  for (const hit of hits) {
    const list = idsByType.get(hit.entityType) ?? [];
    list.push(hit.entityId);
    idsByType.set(hit.entityType, list);
  }

  const params: SqlValue[] = [];
  const branches: string[] = [];
  for (const branch of BRANCHES) {
    const ids = idsByType.get(branch.entityType) ?? [];
    if (ids.length === 0) continue;
    params.push(projectId, ...ids);
    const placeholders = ids.map(() => "?").join(", ");
    branches.push(`SELECT '${branch.entityType}' AS entity_type, t.id AS entity_id,
        ${DETAIL_SELECT[branch.entityType]} AS detail
      FROM ${branch.table} t ${DETAIL_JOINS[branch.entityType] ?? ""}
     WHERE t.project_id = ? AND t.id IN (${placeholders})`);
  }

  const rows = await runner.query<{
    entity_type: string;
    entity_id: string;
    detail: string | null;
  }>(branches.join("\nUNION ALL\n"), params);
  const details = new Map(
    rows.map((row) => [`${row.entity_type}:${row.entity_id}`, row.detail ?? ""]),
  );
  for (const hit of hits) hit.detail = details.get(`${hit.entityType}:${hit.entityId}`) ?? "";
}

export interface SearchOptions {
  /** Hits kept per entity type (the sheet groups by type, so this is the group size). */
  perType?: number;
  /** Total hits across groups. */
  total?: number;
}

/**
 * Runs the token pass, then the trigram pass for names, and merges: a hit found by both is
 * kept once (exact wins), and the groups come back in the order the UI shows them.
 */
export async function searchProject(
  runner: SearchRunner,
  projectId: UUID,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResults> {
  const started = now();
  const perType = options.perType ?? 8;
  const total = options.total ?? 30;
  const tokenQuery = toFtsQuery(query);
  const trigramQuery = toTrigramQuery(query);
  const hits: SearchHit[] = [];

  if (tokenQuery !== null)
    hits.push(...(await runPass(runner, projectId, tokenQuery, perType, false)));
  if (trigramQuery !== null) {
    const seen = new Set(hits.map((hit) => `${hit.entityType}:${hit.entityId}`));
    const fuzzyHits = await runPass(runner, projectId, trigramQuery, perType, true);
    for (const hit of fuzzyHits) {
      const key = `${hit.entityType}:${hit.entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
  }

  const ranked = hits
    .sort((a, b) => (a.fuzzy === b.fuzzy ? a.score - b.score : a.fuzzy ? 1 : -1))
    .slice(0, total);
  await resolveDetails(runner, projectId, ranked);

  const groups: SearchGroup[] = [];
  for (const branch of BRANCHES) {
    const groupHits = ranked
      .filter((hit) => hit.entityType === branch.entityType)
      .slice(0, perType);
    if (groupHits.length > 0) groups.push({ entityType: branch.entityType, hits: groupHits });
  }

  return {
    query,
    groups,
    total: ranked.length,
    tookMs: Math.round((now() - started) * 100) / 100,
  };
}
