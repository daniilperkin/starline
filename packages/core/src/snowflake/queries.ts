import type { SqlValue } from "../commands";
import type { SnowflakeStepNumber, StepStatus } from "../entities";
import type { EpochMs, UUID } from "../primitives";
import { emptyStepContent } from "./defaults";
import type { SnowflakeStepContent, SnowflakeStepRow } from "./types";

/** The read-only statement surface a storage driver satisfies for queries. */
export interface QueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
}

/** A row of the project picker / Plan header. */
export interface ProjectSummary {
  id: UUID;
  title: string;
  form: string;
  method: string;
  logline: string;
  /** The writer's target length; the step-8 estimate reads it ("62,400 / 80,000 est."). */
  targetWordCount: number | null;
  archived: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

const PROJECT_COLUMNS = `id, title, form, method, logline, target_word_count, archived, created_at, updated_at`;

interface ProjectRawRow {
  id: string;
  title: string;
  form: string;
  method: string;
  logline: string;
  target_word_count: number | null;
  archived: number;
  created_at: number;
  updated_at: number;
}

function toProjectSummary(row: ProjectRawRow): ProjectSummary {
  return {
    id: row.id as UUID,
    title: row.title,
    form: row.form,
    method: row.method,
    logline: row.logline,
    targetWordCount: row.target_word_count,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Active (not soft-deleted, not archived) projects, newest first. */
export async function listProjects(runner: QueryRunner): Promise<ProjectSummary[]> {
  const rows = await runner.query<ProjectRawRow>(
    `SELECT ${PROJECT_COLUMNS} FROM project
      WHERE deleted_at IS NULL AND archived = 0
      ORDER BY created_at DESC`,
  );
  return rows.map(toProjectSummary);
}

export async function getProject(runner: QueryRunner, id: UUID): Promise<ProjectSummary | null> {
  const rows = await runner.query<ProjectRawRow>(
    `SELECT ${PROJECT_COLUMNS} FROM project WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  const row = rows[0];
  return row ? toProjectSummary(row) : null;
}

/**
 * All nine snowflake steps of a project, ordered. Projects created by `createProject`
 * always own all nine rows (the M0 migrations only ever create projects through it).
 */
export async function listSteps(runner: QueryRunner, projectId: UUID): Promise<SnowflakeStepRow[]> {
  const rows = await runner.query<{
    id: string;
    project_id: string;
    step: number;
    status: StepStatus;
    content: string;
    completed_at: number | null;
    overrides: string;
    updated_at: number;
  }>(
    `SELECT id, project_id, step, status, content, completed_at, overrides, updated_at
       FROM snowflake_step WHERE project_id = ? ORDER BY step`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id as UUID,
    projectId: row.project_id as UUID,
    step: row.step as SnowflakeStepNumber,
    status: row.status,
    content: parseJson<SnowflakeStepContent>(
      row.content,
      emptyStepContent(row.step as SnowflakeStepNumber),
    ),
    completedAt: row.completed_at,
    overrides: parseJson<string[]>(row.overrides, []),
    updatedAt: row.updated_at,
  }));
}

export async function getStep(
  runner: QueryRunner,
  projectId: UUID,
  step: SnowflakeStepNumber,
): Promise<SnowflakeStepRow | null> {
  const rows = await listSteps(runner, projectId);
  return rows.find((row) => row.step === step) ?? null;
}

export interface ProjectProgress {
  done: number;
  total: number;
}

export function progressOf(steps: readonly SnowflakeStepRow[]): ProjectProgress {
  return { done: steps.filter((step) => step.status === "complete").length, total: steps.length };
}

/** One row of the dashboard's "Continue where you left off" card. */
export interface RecentEntity {
  kind: "step" | "character" | "scene";
  id: UUID;
  /** Display label: the character name / scene line; steps carry their number instead. */
  label: string;
  step: SnowflakeStepNumber | null;
  updatedAt: EpochMs;
}

/** Everything the M1 dashboard cards read (spec §4.1: counts, words, recent, target). */
export interface DashboardStats {
  characterCount: number;
  sceneCount: number;
  loreCount: number;
  noteCount: number;
  /** Sum of scene target words — the step-8 estimate the dashboard shows until drafts exist. */
  estimatedWords: number;
  targetWordCount: number | null;
  recent: RecentEntity[];
}

/** Dashboard aggregates in one call: counts, the running estimate and the last five edits. */
export async function getDashboardStats(
  runner: QueryRunner,
  projectId: UUID,
): Promise<DashboardStats> {
  const counts = (
    await runner.query<{
      characters: number;
      scenes: number;
      lore: number;
      notes: number;
      estimated_words: number;
      target_word_count: number | null;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM character WHERE project_id = ? AND deleted_at IS NULL) AS characters,
         (SELECT COUNT(*) FROM scene     WHERE project_id = ? AND deleted_at IS NULL) AS scenes,
         (SELECT COUNT(*) FROM lore_entry WHERE project_id = ? AND deleted_at IS NULL) AS lore,
         (SELECT COUNT(*) FROM idea_note  WHERE project_id = ? AND deleted_at IS NULL) AS notes,
         (SELECT COALESCE(SUM(target_word_count), 0) FROM scene
           WHERE project_id = ? AND deleted_at IS NULL) AS estimated_words,
         (SELECT target_word_count FROM project WHERE id = ?) AS target_word_count`,
      [projectId, projectId, projectId, projectId, projectId, projectId],
    )
  )[0];

  const recent: RecentEntity[] = [];
  const stepRows = await runner.query<{ id: string; step: number; updated_at: number }>(
    `SELECT id, step, updated_at FROM snowflake_step
      WHERE project_id = ? AND status != 'not_started' ORDER BY updated_at DESC LIMIT 5`,
    [projectId],
  );
  for (const row of stepRows) {
    recent.push({
      kind: "step",
      id: row.id as UUID,
      label: "",
      step: row.step as SnowflakeStepNumber,
      updatedAt: row.updated_at,
    });
  }
  const characterRows = await runner.query<{ id: string; name: string; updated_at: number }>(
    `SELECT id, name, updated_at FROM character
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5`,
    [projectId],
  );
  for (const row of characterRows) {
    recent.push({
      kind: "character",
      id: row.id as UUID,
      label: row.name,
      step: null,
      updatedAt: row.updated_at,
    });
  }
  const sceneRows = await runner.query<{
    id: string;
    title: string;
    synopsis_text: string;
    updated_at: number;
  }>(
    `SELECT id, title, synopsis_text, updated_at FROM scene
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5`,
    [projectId],
  );
  for (const row of sceneRows) {
    recent.push({
      kind: "scene",
      id: row.id as UUID,
      label: row.title.trim() || (row.synopsis_text.split("\n")[0]?.trim() ?? ""),
      step: null,
      updatedAt: row.updated_at,
    });
  }
  recent.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    characterCount: counts?.characters ?? 0,
    sceneCount: counts?.scenes ?? 0,
    loreCount: counts?.lore ?? 0,
    noteCount: counts?.notes ?? 0,
    estimatedWords: counts?.estimated_words ?? 0,
    targetWordCount: counts?.target_word_count ?? null,
    recent: recent.slice(0, 5),
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}
