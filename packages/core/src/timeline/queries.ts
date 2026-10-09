import type { SqlValue } from "../commands";
import type { SceneStatus } from "../entities";
import type { UUID } from "../primitives";
import type { TimelineCalendar } from "../settings";
import { parseCalendar } from "./calendar";
import {
  NOMINAL_SCENE_SECONDS,
  type NoTimeScene,
  type TimelineConflict,
  type TimelineData,
  type TimelineEventItem,
  type TimelineItem,
  type TimelineLane,
  type TimelineLaneKind,
  type TimelineSceneItem,
} from "./types";

/** Timeline reads (spec §4.4.1). One pass over scenes, events and the two join tables. */

export interface TimelineQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

export async function getTimelineCalendar(
  runner: TimelineQueryRunner,
  projectId: UUID,
): Promise<TimelineCalendar> {
  const rows = await runner.query<{ settings: string | null }>(
    "SELECT settings FROM project WHERE id = ? AND deleted_at IS NULL",
    [projectId],
  );
  return parseCalendar(rows[0]?.settings ?? null);
}

interface SceneRow {
  id: string;
  title: string;
  story_time: number;
  story_time_label: string;
  status: string;
  pov_name: string | null;
  location_name: string | null;
  pov_character_id: string | null;
}

const PLACED_SCENES = `
  SELECT s.id, s.title, s.story_time, s.story_time_label, s.status,
         c.name AS pov_name, l.name AS location_name, s.pov_character_id
    FROM scene s
    LEFT JOIN character c ON c.id = s.pov_character_id
    LEFT JOIN lore_entry l ON l.id = s.location_id`;

function toSceneItem(row: SceneRow): TimelineSceneItem {
  return {
    kind: "scene",
    id: row.id as UUID,
    title: row.title,
    storyTime: Number(row.story_time),
    storyTimeEnd: null,
    storyTimeLabel: row.story_time_label ?? "",
    status: row.status as SceneStatus,
    povName: row.pov_name,
    locationName: row.location_name,
  };
}

/**
 * Everything the timeline view needs: lanes (world, per character, per plotline), the placed
 * scenes and events, the no-time tray, the range and the "two places at once" warnings.
 */
export async function getTimeline(
  runner: TimelineQueryRunner,
  projectId: UUID,
): Promise<TimelineData> {
  const calendar = await getTimelineCalendar(runner, projectId);

  const sceneRows = await runner.query<SceneRow>(
    `${PLACED_SCENES}
      WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.story_time IS NOT NULL
      ORDER BY s.story_time`,
    [projectId],
  );
  const noTimeRows = await runner.query<{ id: string; title: string; status: string }>(
    `SELECT s.id, s.title, s.status FROM scene s
      WHERE s.project_id = ? AND s.deleted_at IS NULL AND s.story_time IS NULL
      ORDER BY s.order_key`,
    [projectId],
  );
  const eventRows = await runner.query<{
    id: string;
    title: string;
    story_time: number;
    story_time_end: number | null;
    story_time_label: string;
    lane: string;
    character_id: string | null;
    plotline_id: string | null;
    scene_id: string | null;
    lore_entry_id: string | null;
    color: string | null;
    description_text: string;
  }>(
    `SELECT id, title, story_time, story_time_end, story_time_label, lane, character_id,
            plotline_id, scene_id, lore_entry_id, color, description_text
       FROM timeline_event
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY story_time`,
    [projectId],
  );
  const castRows = await runner.query<{ scene_id: string; character_id: string }>(
    `SELECT sc.scene_id, sc.character_id
       FROM scene_character sc
       JOIN scene s ON s.id = sc.scene_id AND s.deleted_at IS NULL
      WHERE s.project_id = ? AND s.story_time IS NOT NULL`,
    [projectId],
  );
  const plotlineRows = await runner.query<{ scene_id: string; plotline_id: string }>(
    `SELECT sp.scene_id, sp.plotline_id
       FROM scene_plotline sp
       JOIN scene s ON s.id = sp.scene_id AND s.deleted_at IS NULL
       JOIN plotline p ON p.id = sp.plotline_id AND p.deleted_at IS NULL
      WHERE s.project_id = ? AND s.story_time IS NOT NULL`,
    [projectId],
  );
  const characterRows = await runner.query<{ id: string; name: string; color: string | null }>(
    "SELECT id, name, color FROM character WHERE project_id = ? AND deleted_at IS NULL ORDER BY name",
    [projectId],
  );
  const plotlineRowsAll = await runner.query<{ id: string; name: string; color: string }>(
    `SELECT id, name, color FROM plotline
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
    [projectId],
  );

  const sceneItems = new Map<string, TimelineSceneItem>();
  for (const row of sceneRows) sceneItems.set(row.id, toSceneItem(row));
  const events: TimelineEventItem[] = eventRows.map((row) => ({
    kind: "event",
    id: row.id as UUID,
    title: row.title,
    storyTime: Number(row.story_time),
    storyTimeEnd: row.story_time_end === null ? null : Number(row.story_time_end),
    storyTimeLabel: row.story_time_label ?? "",
    lane: row.lane as TimelineLaneKind,
    characterId: (row.character_id as UUID | null) ?? null,
    plotlineId: (row.plotline_id as UUID | null) ?? null,
    color: row.color,
    sceneId: (row.scene_id as UUID | null) ?? null,
    loreEntryId: (row.lore_entry_id as UUID | null) ?? null,
    description: row.description_text ?? "",
  }));
  const eventLane = new Map<string, TimelineEventItem>();
  for (const [index, row] of eventRows.entries()) {
    const item = events[index];
    if (item) eventLane.set(row.id, item);
  }

  const charactersInScene = new Map<string, string[]>();
  for (const row of castRows) {
    const list = charactersInScene.get(row.scene_id) ?? [];
    list.push(row.character_id);
    charactersInScene.set(row.scene_id, list);
  }
  // The POV is present by definition (spec §4.3.4: "Present characters, POV auto-included"),
  // and older scenes may predate the cast row.
  for (const row of sceneRows) {
    if (!row.pov_character_id) continue;
    const list = charactersInScene.get(row.id) ?? [];
    if (!list.includes(row.pov_character_id)) list.push(row.pov_character_id);
    charactersInScene.set(row.id, list);
  }

  const lanes: TimelineLane[] = [];
  const worldItems: TimelineItem[] = eventRows
    .filter((row) => row.lane === "world")
    .map((row) => eventLane.get(row.id) as TimelineEventItem);
  lanes.push({
    id: "world",
    kind: "world",
    label: "World",
    color: null,
    characterId: null,
    plotlineId: null,
    items: worldItems,
  });

  for (const character of characterRows) {
    const items: TimelineItem[] = [];
    for (const [sceneId, cast] of charactersInScene) {
      if (!cast.includes(character.id)) continue;
      const item = sceneItems.get(sceneId);
      if (item) items.push(item);
    }
    for (const row of eventRows) {
      if (row.lane !== "character" || row.character_id !== character.id) continue;
      const item = eventLane.get(row.id);
      if (item) items.push(item);
    }
    if (items.length === 0) continue;
    items.sort((a, b) => a.storyTime - b.storyTime);
    lanes.push({
      id: `character:${character.id}`,
      kind: "character",
      label: character.name,
      color: character.color,
      characterId: character.id as UUID,
      plotlineId: null,
      items,
    });
  }

  const scenesByPlotline = new Map<string, string[]>();
  for (const row of plotlineRows) {
    const list = scenesByPlotline.get(row.plotline_id) ?? [];
    list.push(row.scene_id);
    scenesByPlotline.set(row.plotline_id, list);
  }
  for (const plotline of plotlineRowsAll) {
    const items: TimelineItem[] = [];
    for (const sceneId of scenesByPlotline.get(plotline.id) ?? []) {
      const item = sceneItems.get(sceneId);
      if (item) items.push(item);
    }
    for (const row of eventRows) {
      if (row.lane !== "plot" || row.plotline_id !== plotline.id) continue;
      const item = eventLane.get(row.id);
      if (item) items.push(item);
    }
    if (items.length === 0) continue;
    items.sort((a, b) => a.storyTime - b.storyTime);
    lanes.push({
      id: `plot:${plotline.id}`,
      kind: "plot",
      label: plotline.name,
      color: plotline.color,
      characterId: null,
      plotlineId: plotline.id as UUID,
      items,
    });
  }

  const conflicts = await detectTimelineConflicts(runner, projectId);

  let range: { start: number; end: number } | null = null;
  for (const lane of lanes) {
    for (const item of lane.items) {
      const end = item.storyTimeEnd ?? item.storyTime;
      range = range ?? { start: item.storyTime, end };
      range.start = Math.min(range.start, item.storyTime);
      range.end = Math.max(range.end, end);
    }
  }

  return {
    calendar,
    lanes,
    noTime: noTimeRows.map((row) => ({
      id: row.id as UUID,
      title: row.title,
      status: row.status as SceneStatus,
    })) satisfies NoTimeScene[],
    conflicts,
    range,
  };
}

/**
 * "Can't be in two places at once" (spec §4.4.1): a character in two scenes whose story windows
 * overlap in different locations. Warning only — the writer may well intend a flashback, so this
 * never blocks anything. A scene's window is `storyTime + NOMINAL_SCENE_SECONDS` until scenes
 * carry a real end time.
 */
export async function detectTimelineConflicts(
  runner: TimelineQueryRunner,
  projectId: UUID,
): Promise<TimelineConflict[]> {
  const rows = await runner.query<{
    character_id: string;
    character_name: string;
    a_id: string;
    a_title: string;
    a_location: string;
    b_id: string;
    b_title: string;
    b_location: string;
  }>(
    `SELECT ca.character_id AS character_id, ch.name AS character_name,
            sa.id AS a_id, sa.title AS a_title, la.name AS a_location,
            sb.id AS b_id, sb.title AS b_title, lb.name AS b_location
       FROM scene_character ca
       JOIN scene_character cb
         ON cb.character_id = ca.character_id AND cb.scene_id > ca.scene_id
       JOIN scene sa ON sa.id = ca.scene_id AND sa.deleted_at IS NULL AND sa.story_time IS NOT NULL
       JOIN scene sb ON sb.id = cb.scene_id AND sb.deleted_at IS NULL AND sb.story_time IS NOT NULL
       JOIN character ch ON ch.id = ca.character_id AND ch.deleted_at IS NULL
       JOIN lore_entry la ON la.id = sa.location_id AND la.deleted_at IS NULL
       JOIN lore_entry lb ON lb.id = sb.location_id AND lb.deleted_at IS NULL
      WHERE sa.project_id = ? AND sb.project_id = ?
        AND sa.location_id <> sb.location_id
        AND sa.story_time < sb.story_time + ?
        AND sb.story_time < sa.story_time + ?
      ORDER BY ch.name, sa.story_time`,
    [projectId, projectId, NOMINAL_SCENE_SECONDS, NOMINAL_SCENE_SECONDS],
  );
  return rows.map((row) => ({
    characterId: row.character_id as UUID,
    characterName: row.character_name,
    sceneAId: row.a_id as UUID,
    sceneATitle: row.a_title,
    sceneALocation: row.a_location,
    sceneBId: row.b_id as UUID,
    sceneBTitle: row.b_title,
    sceneBLocation: row.b_location,
  }));
}

/** Placed vs unplaced counts for the timeline header. */
export async function getTimelineCoverage(
  runner: TimelineQueryRunner,
  projectId: UUID,
): Promise<{ placed: number; unplaced: number }> {
  const rows = await runner.query<{ placed: number; unplaced: number }>(
    `SELECT SUM(CASE WHEN story_time IS NOT NULL THEN 1 ELSE 0 END) AS placed,
            SUM(CASE WHEN story_time IS NULL THEN 1 ELSE 0 END) AS unplaced
       FROM scene WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  );
  return {
    placed: Number(rows[0]?.placed ?? 0),
    unplaced: Number(rows[0]?.unplaced ?? 0),
  };
}
