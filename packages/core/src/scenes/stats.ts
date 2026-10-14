/**
 * The Scenes tab's statistics strip (spec §4.3.2, S36): totals, per-status distribution, words
 * written vs target, and the chapter spread. One read-only query pair; the UI renders the bars.
 */
import type { SqlValue } from "../commands";
import type { SceneStatus } from "../entities";
import type { UUID } from "../primitives";
import { SCENE_STATUSES } from "./types";

export interface SceneStats {
  total: number;
  /** Scenes per status (every status key present, zero-filled). */
  byStatus: Record<SceneStatus, number>;
  /** Words actually written across drafts. */
  wordsWritten: number;
  /** Sum of targets where set (0 when none). */
  wordsTarget: number;
  /** Chapters with at least one scene, and scenes not in a chapter. */
  chapters: number;
  unassigned: number;
}

export interface SceneStatsRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/** Zero-filled status map so the strip's bar widths are stable before any scenes exist. */
export function emptyStats(): SceneStats {
  const byStatus = {} as Record<SceneStatus, number>;
  for (const status of SCENE_STATUSES) byStatus[status] = 0;
  return { total: 0, byStatus, wordsWritten: 0, wordsTarget: 0, chapters: 0, unassigned: 0 };
}

export async function sceneStats(runner: SceneStatsRunner, projectId: UUID): Promise<SceneStats> {
  const rows = await runner.query<{
    status: string;
    n: number;
    words: number;
    target: number;
    chapters: number;
  }>(
    `SELECT status,
            COUNT(*) AS n,
            COALESCE(SUM(body_word_count), 0) AS words,
            COALESCE(SUM(target_word_count), 0) AS target,
            COUNT(DISTINCT chapter_id) AS chapters
       FROM scene
      WHERE project_id = ? AND deleted_at IS NULL
      GROUP BY status`,
    [projectId],
  );
  const stats = emptyStats();
  for (const row of rows) {
    const status = row.status as SceneStatus;
    if (SCENE_STATUSES.includes(status)) stats.byStatus[status] = row.n;
    stats.total += row.n;
    stats.wordsWritten += row.words;
    stats.wordsTarget += row.target;
  }
  const chapterRows = await runner.query<{ chapters: number; unassigned: number }>(
    `SELECT COUNT(DISTINCT chapter_id) AS chapters,
            SUM(CASE WHEN chapter_id IS NULL THEN 1 ELSE 0 END) AS unassigned
       FROM scene
      WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  );
  stats.chapters = chapterRows[0]?.chapters ?? 0;
  stats.unassigned = chapterRows[0]?.unassigned ?? 0;
  return stats;
}
