import type { SqlValue } from "../commands";
import type { SceneOutcome, SceneStatus, TimeOfDay } from "../entities";
import type { UUID } from "../primitives";
import { countWords, type RichText } from "../richtext";
import type {
  ChapterSummary,
  PartSummary,
  PlotlineKind,
  PlotlineSummary,
  SceneContextInfo,
  SceneDetail,
  SceneSummary,
  SnowflakeSource,
} from "./types";

/** The read-only statement surface a storage driver satisfies for queries. */
export interface SceneQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

const SCENE_SELECT = `SELECT s.id, s.project_id, s.chapter_id, s.order_key, s.title,
         s.synopsis_json, s.synopsis_text, s.pov_character_id, s.location_id,
         s.objective, s.obstacle, s.outcome, s.outcome_note,
         s.emotion_start, s.emotion_end, s.status, s.body_word_count, s.target_word_count,
         s.story_time, s.story_time_label, s.time_of_day, s.snowflake_source,
         s.created_at, s.updated_at,
         c.name AS pov_name, l.name AS location_name
    FROM scene s
    LEFT JOIN character c ON c.id = s.pov_character_id
    LEFT JOIN lore_entry l ON l.id = s.location_id`;

interface RawSceneRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  order_key: string;
  title: string;
  synopsis_json: string | null;
  synopsis_text: string;
  pov_character_id: string | null;
  location_id: string | null;
  objective: string;
  obstacle: string;
  outcome: string;
  outcome_note: string;
  emotion_start: string;
  emotion_end: string;
  status: string;
  body_word_count: number;
  target_word_count: number | null;
  story_time: number | null;
  story_time_label: string;
  time_of_day: string;
  snowflake_source: string | null;
  created_at: number;
  updated_at: number;
  pov_name: string | null;
  location_name: string | null;
}

function toSceneSummary(row: RawSceneRow): SceneSummary {
  return {
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    chapterId: row.chapter_id as UUID | null,
    orderKey: row.order_key,
    title: row.title,
    synopsis: {
      json: parseJson<RichText["json"]>(row.synopsis_json ?? "", null),
      text: row.synopsis_text,
      wordCount: countWords(row.synopsis_text),
    },
    povCharacterId: row.pov_character_id as UUID | null,
    povName: row.pov_name,
    locationId: row.location_id as UUID | null,
    locationName: row.location_name,
    objective: row.objective,
    obstacle: row.obstacle,
    outcome: row.outcome as SceneOutcome,
    outcomeNote: row.outcome_note,
    emotionStart: row.emotion_start,
    emotionEnd: row.emotion_end,
    status: row.status as SceneStatus,
    bodyWordCount: row.body_word_count,
    targetWordCount: row.target_word_count,
    storyTime: row.story_time,
    storyTimeLabel: row.story_time_label,
    timeOfDay: row.time_of_day as TimeOfDay,
    snowflakeSource:
      row.snowflake_source === null
        ? null
        : parseJson<SnowflakeSource | null>(row.snowflake_source, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Active scenes of a project, in raw `order_key` order (use `orderScenesBookWise` for book order). */
export async function listScenes(
  runner: SceneQueryRunner,
  projectId: UUID,
): Promise<SceneSummary[]> {
  const rows = await runner.query<RawSceneRow>(
    `${SCENE_SELECT} WHERE s.project_id = ? AND s.deleted_at IS NULL ORDER BY s.order_key`,
    [projectId],
  );
  return rows.map(toSceneSummary);
}

/** Book order (spec §4.3): by chapter position, then scene order — the Unassigned pool last. */
export function orderScenesBookWise(
  chapters: readonly ChapterSummary[],
  scenes: readonly SceneSummary[],
): SceneSummary[] {
  const chapterIndex = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const rankOf = (scene: SceneSummary): number =>
    scene.chapterId !== null && chapterIndex.has(scene.chapterId)
      ? (chapterIndex.get(scene.chapterId) as number)
      : Number.MAX_SAFE_INTEGER;
  return [...scenes].sort((a, b) => {
    const rankA = rankOf(a);
    const rankB = rankOf(b);
    if (rankA !== rankB) return rankA - rankB;
    return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
  });
}

/** One scene with its joins — what the editor sheet loads. */
export async function getSceneDetail(
  runner: SceneQueryRunner,
  projectId: UUID,
  sceneId: UUID,
): Promise<SceneDetail | null> {
  const row = (
    await runner.query<RawSceneRow>(
      `${SCENE_SELECT} WHERE s.id = ? AND s.project_id = ? AND s.deleted_at IS NULL`,
      [sceneId, projectId],
    )
  )[0];
  if (!row) return null;
  const present = await runner.query<{ character_id: string }>(
    `SELECT character_id FROM scene_character WHERE scene_id = ? AND presence = 'present'`,
    [sceneId],
  );
  const lore = await runner.query<{ lore_entry_id: string }>(
    `SELECT lore_entry_id FROM scene_lore WHERE scene_id = ?`,
    [sceneId],
  );
  const plotlines = await runner.query<{ plotline_id: string; beat: string }>(
    `SELECT plotline_id, beat FROM scene_plotline WHERE scene_id = ?`,
    [sceneId],
  );
  const tags = await runner.query<{ tag_id: string }>(
    `SELECT tag_id FROM entity_tag WHERE entity_type = 'scene' AND entity_id = ?`,
    [sceneId],
  );
  return {
    ...toSceneSummary(row),
    presentCharacterIds: present.map((entry) => entry.character_id as UUID),
    loreIds: lore.map((entry) => entry.lore_entry_id as UUID),
    plotlines: plotlines.map((entry) => ({
      plotlineId: entry.plotline_id as UUID,
      beat: entry.beat,
    })),
    tagIds: tags.map((entry) => entry.tag_id as UUID),
  };
}

/** The lightweight scene slice the S8_* validators read. */
export async function listSceneContext(
  runner: SceneQueryRunner,
  projectId: UUID,
): Promise<SceneContextInfo[]> {
  const rows = await runner.query<{
    id: string;
    pov_character_id: string | null;
    chapter_id: string | null;
    synopsis_text: string;
  }>(
    `SELECT id, pov_character_id, chapter_id, synopsis_text FROM scene
      WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    povCharacterId: row.pov_character_id as UUID | null,
    chapterId: row.chapter_id as UUID | null,
    synopsisWords: countWords(row.synopsis_text),
  }));
}

export async function listParts(runner: SceneQueryRunner, projectId: UUID): Promise<PartSummary[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    title: string;
    order_key: string;
    color: string | null;
  }>(
    `SELECT id, project_id, title, order_key, color FROM part
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    title: row.title,
    orderKey: row.order_key,
    color: row.color,
  }));
}

export async function listChapters(
  runner: SceneQueryRunner,
  projectId: UUID,
): Promise<ChapterSummary[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    part_id: string | null;
    title: string;
    order_key: string;
    color: string | null;
  }>(
    `SELECT id, project_id, part_id, title, order_key, color FROM chapter
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    partId: row.part_id as UUID | null,
    title: row.title,
    orderKey: row.order_key,
    color: row.color,
  }));
}

export async function listPlotlines(
  runner: SceneQueryRunner,
  projectId: UUID,
): Promise<PlotlineSummary[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    name: string;
    kind: string;
    color: string;
    character_id: string | null;
    order_key: string;
  }>(
    `SELECT id, project_id, name, kind, color, character_id, order_key FROM plotline
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    name: row.name,
    kind: row.kind as PlotlineKind,
    color: row.color,
    characterId: row.character_id as UUID | null,
    orderKey: row.order_key,
  }));
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}
