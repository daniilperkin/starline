import type { SqlValue } from "../commands";
import type { RelationshipKind } from "../entities";
import type { UUID } from "../primitives";
import { countWords, type RichText } from "../richtext";
import type {
  GraphPositions,
  RelationshipCharacter,
  RelationshipEdge,
  RelationshipGroupSummary,
  RelationshipMatrix,
} from "./types";

/** The read-only statement surface a storage driver satisfies for relationship queries. */
export interface RelationshipQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

const META_GRAPH_POSITIONS = "graph_positions";

interface EdgeRow {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  kind: string;
  custom_label: string;
  directed: number;
  sentiment: number;
  notes_json: string | null;
  notes_text: string;
  group_id: string | null;
  starts_at_scene_id: string | null;
  ends_at_scene_id: string | null;
  secret: number;
  updated_at: number;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}

function toEdge(row: EdgeRow): RelationshipEdge {
  return {
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    sourceId: row.source_id as UUID,
    targetId: row.target_id as UUID,
    kind: row.kind as RelationshipKind,
    customLabel: row.custom_label,
    directed: row.directed === 1,
    sentiment: row.sentiment,
    notes: {
      json: parseJson<RichText["json"]>(row.notes_json ?? "", null),
      text: row.notes_text,
      wordCount: countWords(row.notes_text),
    },
    groupId: (row.group_id as UUID | null) ?? null,
    startsAtSceneId: (row.starts_at_scene_id as UUID | null) ?? null,
    endsAtSceneId: (row.ends_at_scene_id as UUID | null) ?? null,
    secret: row.secret === 1,
    updatedAt: row.updated_at,
  };
}

const EDGE_COLUMNS = `r.id, r.project_id, r.source_id, r.target_id, r.kind, r.custom_label, r.directed,
       r.sentiment, r.notes_json, r.notes_text, r.group_id, r.starts_at_scene_id,
       r.ends_at_scene_id, r.secret, r.updated_at`;

/**
 * Every live edge of a project whose *both* ends are live characters (spec §3.5: "Relationship
 * has no meaning without both ends") — a trashed character takes its edges out of the matrix and
 * the graph without touching them, and restoring the character brings them straight back.
 */
export async function listRelationships(
  runner: RelationshipQueryRunner,
  projectId: UUID,
): Promise<RelationshipEdge[]> {
  const rows = await runner.query<EdgeRow>(
    `SELECT ${EDGE_COLUMNS} FROM character_relationship r
       JOIN character s ON s.id = r.source_id AND s.deleted_at IS NULL
       JOIN character t ON t.id = r.target_id AND t.deleted_at IS NULL
      WHERE r.project_id = ? AND r.deleted_at IS NULL
      ORDER BY r.created_at, r.id`,
    [projectId],
  );
  return rows.map(toEdge);
}

export async function listRelationshipGroups(
  runner: RelationshipQueryRunner,
  projectId: UUID,
): Promise<RelationshipGroupSummary[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    name: string;
    color: string;
    order_key: string;
  }>(
    `SELECT id, project_id, name, color, order_key FROM relationship_group
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    name: row.name,
    color: row.color,
    orderKey: row.order_key,
  }));
}

/**
 * The whole relationship surface in three reads (characters, edges, groups). The matrix needs
 * the character list anyway, and the graph needs the same three — one call keeps the two views
 * in sync and the wasm round trips down.
 */
export async function getRelationshipMatrix(
  runner: RelationshipQueryRunner,
  projectId: UUID,
): Promise<RelationshipMatrix> {
  const [characters, edges, groups] = await Promise.all([
    runner.query<{ id: string; name: string; color: string; role: string }>(
      `SELECT id, name, color, role FROM character
        WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
      [projectId],
    ),
    listRelationships(runner, projectId),
    listRelationshipGroups(runner, projectId),
  ]);
  return {
    characters: characters.map((row) => ({
      id: row.id as UUID,
      name: row.name,
      color: row.color,
      role: row.role,
    })) satisfies RelationshipCharacter[],
    edges,
    groups,
  };
}

/**
 * Live-edge counts per character, counting each edge for both ends (a character card shows how
 * connected they are; the People filter "has no relationships" reads this map).
 */
export async function countRelationshipsByCharacter(
  runner: RelationshipQueryRunner,
  projectId: UUID,
): Promise<Map<UUID, number>> {
  const rows = await runner.query<{ character_id: string; total: number }>(
    `SELECT character_id, COUNT(*) AS total FROM (
        SELECT r.source_id AS character_id FROM character_relationship r
          JOIN character t ON t.id = r.target_id AND t.deleted_at IS NULL
          WHERE r.project_id = ? AND r.deleted_at IS NULL
        UNION ALL
        SELECT r.target_id AS character_id FROM character_relationship r
          JOIN character s ON s.id = r.source_id AND s.deleted_at IS NULL
          WHERE r.project_id = ? AND r.deleted_at IS NULL
      ) GROUP BY character_id`,
    [projectId, projectId],
  );
  return new Map(rows.map((row) => [row.character_id as UUID, Number(row.total)]));
}

export interface SharedScenes {
  total: number;
  scenes: Array<{ id: UUID; title: string; chapterTitle: string | null }>;
}

/**
 * Scenes both characters appear in (spec §4.2.3 selection inspector: "Mina & Tor appear
 * together in 9 scenes"). The list is capped for the inspector; `total` is the real count.
 */
export async function listSharedScenes(
  runner: RelationshipQueryRunner,
  projectId: UUID,
  firstId: UUID,
  secondId: UUID,
  limit = 10,
): Promise<SharedScenes> {
  const totalRows = await runner.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM scene_character a
       JOIN scene_character b ON b.scene_id = a.scene_id
       JOIN scene s ON s.id = a.scene_id
      WHERE a.character_id = ? AND b.character_id = ? AND s.project_id = ? AND s.deleted_at IS NULL`,
    [firstId, secondId, projectId],
  );
  const rows = await runner.query<{ id: string; title: string; chapter_title: string | null }>(
    `SELECT s.id, s.title, c.title AS chapter_title FROM scene_character a
       JOIN scene_character b ON b.scene_id = a.scene_id
       JOIN scene s ON s.id = a.scene_id
       LEFT JOIN chapter c ON c.id = s.chapter_id
      WHERE a.character_id = ? AND b.character_id = ? AND s.project_id = ? AND s.deleted_at IS NULL
      ORDER BY s.order_key LIMIT ?`,
    [firstId, secondId, projectId, limit],
  );
  return {
    total: Number(totalRows[0]?.total ?? 0),
    scenes: rows.map((row) => ({
      id: row.id as UUID,
      title: row.title,
      chapterTitle: row.chapter_title,
    })),
  };
}

/** Manual pins for one project's graph (spec §4.2.3 `meta.graph_positions`). */
export async function getGraphPositions(
  runner: RelationshipQueryRunner,
  projectId: UUID,
): Promise<GraphPositions> {
  const rows = await runner.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
    META_GRAPH_POSITIONS,
  ]);
  const all = parseJson<Record<string, GraphPositions>>(rows[0]?.value ?? "", {});
  return all[projectId] ?? {};
}
