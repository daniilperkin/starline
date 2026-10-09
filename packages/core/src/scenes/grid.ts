import type { SqlValue } from "../commands";
import type { OrderKey, UUID } from "../primitives";
import type { PlotlineKind } from "./types";

/**
 * Plotline grid (spec §4.3.3, Plottr-style matrix): rows are plotlines, columns are the scenes
 * in book order, a cell is the `scene_plotline` link with its beat. The balance statistics come
 * straight out of SQL — no stored aggregates — because the grid is the only writer and a
 * denormalised counter would drift the moment a scene is trashed.
 */

export interface GridQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

export interface GridScene {
  id: UUID;
  title: string;
  chapterId: UUID | null;
  chapterTitle: string;
  partTitle: string;
  /** 0-based position in book order. */
  index: number;
}

export interface GridPlotline {
  id: UUID;
  name: string;
  color: string;
  kind: PlotlineKind;
  characterId: UUID | null;
  orderKey: OrderKey;
}

export interface GridCell {
  beat: string;
}

export interface PlotlineGrid {
  plotlines: GridPlotline[];
  scenes: GridScene[];
  /** Keyed by `plotlineId:sceneId` — absent means "not attached". */
  cells: Record<string, GridCell>;
}

export function gridCellKey(plotlineId: UUID, sceneId: UUID): string {
  return `${plotlineId}:${sceneId}`;
}

/**
 * Book order: part → chapter → scene, with the unassigned pool last (it is last in the
 * outliner too, so the grid's columns and the outliner's rows read the same way).
 */
const BOOK_ORDER = `(c.id IS NULL), COALESCE(p.order_key, ''), COALESCE(c.order_key, ''), s.order_key`;

const SCENE_ORDER_JOINS = `
  FROM scene s
  LEFT JOIN chapter c ON c.id = s.chapter_id AND c.deleted_at IS NULL
  LEFT JOIN part p ON p.id = c.part_id AND p.deleted_at IS NULL`;

export async function getPlotlineGrid(
  runner: GridQueryRunner,
  projectId: UUID,
): Promise<PlotlineGrid> {
  const plotlines = await runner.query<{
    id: string;
    name: string;
    color: string;
    kind: string;
    character_id: string | null;
    order_key: string;
  }>(
    `SELECT id, name, color, kind, character_id, order_key
       FROM plotline
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY order_key`,
    [projectId],
  );

  const scenes = await runner.query<{
    id: string;
    title: string;
    chapter_id: string | null;
    chapter_title: string | null;
    part_title: string | null;
  }>(
    `SELECT s.id, s.title, s.chapter_id,
            c.title AS chapter_title, p.title AS part_title
       ${SCENE_ORDER_JOINS}
      WHERE s.project_id = ? AND s.deleted_at IS NULL
      ORDER BY ${BOOK_ORDER}`,
    [projectId],
  );

  const links = await runner.query<{ scene_id: string; plotline_id: string; beat: string }>(
    `SELECT sp.scene_id, sp.plotline_id, sp.beat
       FROM scene_plotline sp
       JOIN plotline pl ON pl.id = sp.plotline_id AND pl.deleted_at IS NULL
       JOIN scene s ON s.id = sp.scene_id AND s.deleted_at IS NULL
      WHERE pl.project_id = ?`,
    [projectId],
  );

  const cells: Record<string, GridCell> = {};
  for (const link of links) {
    cells[gridCellKey(link.plotline_id as UUID, link.scene_id as UUID)] = { beat: link.beat };
  }

  return {
    plotlines: plotlines.map((row) => ({
      id: row.id as UUID,
      name: row.name,
      color: row.color,
      kind: row.kind as PlotlineKind,
      characterId: (row.character_id as UUID | null) ?? null,
      orderKey: row.order_key,
    })),
    scenes: scenes.map((row, index) => ({
      id: row.id as UUID,
      title: row.title,
      chapterId: (row.chapter_id as UUID | null) ?? null,
      chapterTitle: row.chapter_title ?? "",
      partTitle: row.part_title ?? "",
      index,
    })),
    cells,
  };
}

export interface PlotlineBalance {
  plotlineId: UUID;
  /** Scenes this plotline is attached to. */
  appearsIn: number;
  totalScenes: number;
  /** Most consecutive scenes it is missing between two appearances (0 = never absent twice). */
  longestGap: number;
  /** 0-based book positions of the first and last appearance; -1 when it never appears. */
  firstIndex: number;
  lastIndex: number;
  /** appearsIn / totalScenes, 0–1. */
  share: number;
  /** Spec §4.3.3: warn when the longest gap is more than a quarter of the book. */
  warn: boolean;
}

/**
 * Balance per plotline in one pass: window functions over the book order, so the numbers are
 * exactly what the grid shows even after reordering, trashing or re-importing scenes.
 */
export async function getPlotlineBalance(
  runner: GridQueryRunner,
  projectId: UUID,
): Promise<PlotlineBalance[]> {
  const rows = await runner.query<{
    plotline_id: string;
    appears_in: number;
    first_idx: number;
    last_idx: number;
    longest_gap: number;
    total_scenes: number;
  }>(
    `WITH ordered AS (
       SELECT s.id AS scene_id,
              ROW_NUMBER() OVER (ORDER BY ${BOOK_ORDER}) - 1 AS idx
         ${SCENE_ORDER_JOINS}
        WHERE s.project_id = ? AND s.deleted_at IS NULL
     ),
     total AS (SELECT COUNT(*) AS n FROM ordered),
     hits AS (
       SELECT sp.plotline_id AS pid, o.idx AS idx
         FROM scene_plotline sp
         JOIN ordered o ON o.scene_id = sp.scene_id
         JOIN plotline pl ON pl.id = sp.plotline_id AND pl.deleted_at IS NULL
        WHERE pl.project_id = ?
     ),
     gaps AS (
       SELECT pid, idx, LAG(idx) OVER (PARTITION BY pid ORDER BY idx) AS prev_idx FROM hits
     ),
     agg AS (
       SELECT pid,
              COUNT(*) AS appears_in,
              MIN(idx) AS first_idx,
              MAX(idx) AS last_idx,
              MAX(idx - COALESCE(prev_idx, idx)) AS biggest_step
         FROM gaps
        GROUP BY pid
     )
     SELECT agg.pid AS plotline_id, agg.appears_in, agg.first_idx, agg.last_idx,
            (SELECT n FROM total) AS total_scenes,
            CASE WHEN agg.biggest_step > 1 THEN agg.biggest_step - 1 ELSE 0 END AS longest_gap
       FROM agg`,
    [projectId, projectId],
  );

  return rows.map((row) => {
    const totalScenes = Number(row.total_scenes ?? 0);
    const appearsIn = Number(row.appears_in ?? 0);
    const longestGap = Number(row.longest_gap ?? 0);
    return {
      plotlineId: row.plotline_id as UUID,
      appearsIn,
      totalScenes,
      longestGap,
      firstIndex: Number(row.first_idx ?? -1),
      lastIndex: Number(row.last_idx ?? -1),
      share: totalScenes > 0 ? appearsIn / totalScenes : 0,
      warn: totalScenes > 0 && longestGap > totalScenes * 0.25,
    };
  });
}

/** The one-line summary the grid header shows ("appears in 6 of 41 scenes; longest gap 14"). */
export function formatBalance(balance: PlotlineBalance): string {
  const base = `${balance.appearsIn} of ${balance.totalScenes} scenes`;
  if (balance.appearsIn === 0) return `${base}; not used yet`;
  return `${base}; longest gap ${balance.longestGap}`;
}
