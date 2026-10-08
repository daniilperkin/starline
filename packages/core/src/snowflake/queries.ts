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
  archived: boolean;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

const PROJECT_COLUMNS = `id, title, form, method, logline, archived, created_at, updated_at`;

interface ProjectRawRow {
  id: string;
  title: string;
  form: string;
  method: string;
  logline: string;
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

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}
