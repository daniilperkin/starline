import type { SqlValue } from "../commands";
import type { EpochMs, UUID } from "../primitives";
import { countWords, type RichText } from "../richtext";
import { listChapters, listScenes, orderScenesBookWise } from "../scenes/queries";
import { type ContinueTarget, type EditorState, META_EDITOR_STATE, type SceneBody } from "./types";

/**
 * Reads behind writing mode (PLAN slice 13). All of them are cheap list-shaped queries so the
 * dashboard card and the write screen can both call them on every open.
 */

export interface EditorQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // a hand-edited file must not brick the editor
  }
}

/** The project's editor state, tolerant of a hand-edited or absent meta row. */
export async function getEditorState(
  runner: EditorQueryRunner,
  projectId: UUID,
): Promise<EditorState> {
  const rows = await runner.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
    META_EDITOR_STATE,
  ]);
  const all = parseJson<Record<string, EditorState>>(rows[0]?.value ?? "", {});
  const state = all[projectId];
  return { lastSceneId: state?.lastSceneId ?? null };
}

/** The draft body of one scene (spec §3.6 `body_json`/`body_text`). */
export async function getSceneBody(
  runner: EditorQueryRunner,
  projectId: UUID,
  sceneId: UUID,
): Promise<SceneBody | null> {
  const rows = await runner.query<{
    body_json: string | null;
    body_text: string;
    updated_at: number;
  }>(
    `SELECT body_json, body_text, updated_at FROM scene
      WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
    [sceneId, projectId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    body: {
      json: parseJson<RichText["json"]>(row.body_json ?? "", null),
      text: row.body_text,
      wordCount: countWords(row.body_text),
    },
    updatedAt: row.updated_at as EpochMs,
  };
}

/**
 * Where "continue writing" should land: the scene the writer last had open, else the first
 * scene in book order that is not marked done, else nothing (the card hides). Deleted scenes
 * never qualify — the state survives a delete, the target does not.
 */
export async function getContinueTarget(
  runner: EditorQueryRunner,
  projectId: UUID,
): Promise<ContinueTarget | null> {
  const { lastSceneId } = await getEditorState(runner, projectId);
  const chapters = await listChapters(runner, projectId);
  const scenes = orderScenesBookWise(chapters, await listScenes(runner, projectId));
  const pick = (scene: (typeof scenes)[number], reason: ContinueTarget["reason"]) =>
    ({
      sceneId: scene.id,
      title: scene.title,
      chapterId: scene.chapterId,
      wordCount: scene.bodyWordCount,
      targetWordCount: scene.targetWordCount,
      status: scene.status,
      reason,
    }) satisfies ContinueTarget;

  const last = lastSceneId === null ? undefined : scenes.find((scene) => scene.id === lastSceneId);
  if (last) return pick(last, "last");
  const next = scenes.find((scene) => scene.status !== "done");
  return next ? pick(next, "next") : null;
}
