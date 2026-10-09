import type { SqlValue } from "../commands";
import type { UUID } from "../primitives";
import { type MentionField, mentionFieldFor, targetLabels } from "./possible";
import { snippetAround } from "./text";
import type { BacklinkSource, Backlinks } from "./types";

/**
 * Backlinks (spec §3.9 `mention`, PLAN slice 7): reads the mirror every rich-text save maintains,
 * resolves each source row's title and the text around the mention, and groups by source so the
 * panel can list "Mentioned in 7 places" and link each one.
 *
 * Cost shape — the storage round trip and the JSON payload dominate, so this read is three
 * queries at most, whatever the number of sources:
 *   1. the mention rows for the target (capped at BACKLINK_MAX_SOURCES, biggest count first),
 *   2. one UNION ALL query that loads every source row of every type present,
 *   3. chapter titles for the scene sources (skipped when there are none).
 * Budget: spec §5.1 wants a backlink query ≤ 10 ms; slice 7 asserts it in the perf suite.
 */

export interface BacklinkRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/**
 * How many sources the panel lists. A character mentioned in 150 scenes would otherwise pull
 * 150 rows of prose across the bridge on every open; the top 40 by mention count is what a
 * reader can act on, and `truncated` tells the UI to say "showing 40 of N".
 */
export const BACKLINK_MAX_SOURCES = 40;

/** Characters of source text loaded per source — enough for a snippet around the mention. */
const SNIPPET_WINDOW = 400;

interface MentionRow {
  source_type: string;
  source_id: string;
  field: string;
  count: number;
}

/** Human label for a source field in the backlink row ("notes", "storyline", …). */
const FIELD_LABELS: Record<string, string> = {
  body: "notes",
  synopsis: "synopsis",
  storyline: "storyline",
  backstory: "backstory",
  summary: "summary",
};

/** Every source row of every type present, in one query (scene rows also carry their chapter). */
async function loadSources(
  runner: BacklinkRunner,
  projectId: UUID,
  fields: readonly MentionField[],
  idsByField: Map<string, string[]>,
): Promise<Map<string, { title: string; text: string; detail: string }>> {
  const params: SqlValue[] = [];
  const branches: string[] = [];
  for (const entry of fields) {
    const ids = idsByField.get(`${entry.sourceType}:${entry.field}`) ?? [];
    if (ids.length === 0) continue;
    params.push(projectId, ...ids);
    const placeholders = ids.map(() => "?").join(", ");
    const detail = entry.sourceType === "scene" ? "COALESCE(c.title, '')" : "''";
    const joins = entry.sourceType === "scene" ? "LEFT JOIN chapter c ON c.id = t.chapter_id" : "";
    branches.push(`SELECT '${entry.sourceType}' AS source_type, t.id AS id, t.${entry.titleColumn} AS title,
        substr(t.${entry.textColumn}, 1, ${SNIPPET_WINDOW}) AS body, ${detail} AS detail
      FROM ${entry.table} t ${joins}
     WHERE t.project_id = ? AND t.deleted_at IS NULL AND t.id IN (${placeholders})`);
  }
  const found = new Map<string, { title: string; text: string; detail: string }>();
  if (branches.length === 0) return found;
  const rows = await runner.query<{
    source_type: string;
    id: string;
    title: string;
    body: string;
    detail: string;
  }>(branches.join("\nUNION ALL\n"), params);
  for (const row of rows) {
    found.set(`${row.source_type}:${row.id}`, {
      title: row.title,
      text: row.body,
      detail: row.detail,
    });
  }
  return found;
}

/**
 * Every place a target is mentioned, grouped by source field, biggest first. Sources whose row
 * vanished (deleted or purged) are skipped — the mirror is derived data and never resurrects.
 */
export async function listBacklinks(
  runner: BacklinkRunner,
  projectId: UUID,
  targetType: string,
  targetId: UUID,
): Promise<Backlinks> {
  const labels = await targetLabels(runner, projectId, targetType, targetId);
  const rows = await runner.query<MentionRow>(
    `SELECT source_type, source_id, field, count FROM mention
      WHERE target_type = ? AND target_id = ?
      ORDER BY count DESC, source_type
      LIMIT ?`,
    [targetType, targetId, BACKLINK_MAX_SOURCES],
  );

  const fields = new Map<string, MentionField>();
  const idsByField = new Map<string, string[]>();
  for (const row of rows) {
    const entry = mentionFieldFor(row.source_type, row.field);
    if (!entry) continue;
    const key = `${entry.sourceType}:${entry.field}`;
    fields.set(key, entry);
    const ids = idsByField.get(key) ?? [];
    ids.push(row.source_id);
    idsByField.set(key, ids);
  }

  const loaded = await loadSources(runner, projectId, [...fields.values()], idsByField);

  const sources: BacklinkSource[] = [];
  let totalOccurrences = 0;
  for (const row of rows) {
    const entry = mentionFieldFor(row.source_type, row.field);
    if (!entry) continue;
    const source = loaded.get(`${entry.sourceType}:${row.source_id}`);
    if (!source) continue;
    totalOccurrences += Number(row.count);
    sources.push({
      sourceType: entry.sourceType,
      sourceId: row.source_id as UUID,
      field: entry.field,
      count: Number(row.count),
      title: source.title.trim() || `(${entry.sourceType})`,
      detail:
        entry.sourceType === "scene"
          ? source.detail || "synopsis"
          : (FIELD_LABELS[entry.field] ?? entry.field),
      snippet: snippetAround(source.text, labels),
    });
  }

  return {
    targetType,
    targetId,
    sources,
    totalOccurrences,
    truncated: rows.length >= BACKLINK_MAX_SOURCES,
  };
}

/** Cheap count for list rows ("3 backlinks") without resolving every source. */
export async function countBacklinks(
  runner: BacklinkRunner,
  _projectId: UUID,
  targetType: string,
  targetId: UUID,
): Promise<number> {
  const rows = await runner.query<{ n: number }>(
    `SELECT COUNT(DISTINCT source_type || ':' || source_id) AS n FROM mention
      WHERE target_type = ? AND target_id = ?`,
    [targetType, targetId],
  );
  return Number(rows[0]?.n ?? 0);
}
