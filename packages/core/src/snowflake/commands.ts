import type { ChangeEvent } from "../changes";
import type { CharacterContextInfo } from "../characters/types";
import type { Command, CommandContext } from "../commands";
import type {
  CharacterRole,
  PlanningMethod,
  SnowflakeStepNumber,
  StepStatus,
  StoryForm,
  ValidationIssue,
} from "../entities";
import { epochNow, newUuid, type UUID } from "../primitives";
import { listSceneContext } from "../scenes/queries";
import type { SceneContextInfo } from "../scenes/types";
import { defaultProjectSettings } from "../settings";
import { emptyStepContent, isStepContentEmpty } from "./defaults";
import { type SnowflakeStepContent, STEP_NUMBERS } from "./types";
import { blockingIssues, validateStep } from "./validators";

/** Thrown by `markStepComplete` when blocking errors remain (spec §3.4.1). */
export class StepBlockedError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(`step is blocked by ${issues.length} issue(s)`);
    this.name = "StepBlockedError";
    this.issues = issues;
  }
}

export interface CreateProjectArgs {
  title: string;
  form?: StoryForm;
  method?: PlanningMethod;
}

/** Creates a project plus its nine snowflake_step rows (all exist from day one, spec §3.4). */
export const createProject: Command<CreateProjectArgs, { projectId: UUID }> = {
  name: "project.create",
  async run(ctx, args) {
    const title = args.title.trim();
    if (title.length === 0) throw new Error("project title is required");
    const projectId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO project (id, title, form, method, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        title,
        args.form ?? "novel",
        args.method ?? "snowflake",
        JSON.stringify(defaultProjectSettings()),
        now,
        now,
      ],
    );
    for (const step of STEP_NUMBERS) {
      await ctx.tx.query(
        `INSERT INTO snowflake_step (id, project_id, step, status, content, overrides, created_at, updated_at)
         VALUES (?, ?, ?, 'not_started', ?, '[]', ?, ?)`,
        [newUuid(), projectId, step, JSON.stringify(emptyStepContent(step)), now, now],
      );
    }
    const changes: ChangeEvent[] = [
      { table: "project", op: "insert", id: projectId },
      { table: "snowflake_step", op: "insert", id: projectId, parentIds: [projectId] },
    ];
    return { result: { projectId }, changes };
  },
};

export interface RenameProjectArgs {
  projectId: UUID;
  title: string;
}

/** Renames a book. The library file holds many; this is the one place a title changes. */
export const renameProject: Command<RenameProjectArgs, void> = {
  name: "project.rename",
  async run(ctx, args) {
    const title = args.title.trim();
    if (title.length === 0) throw new Error("project title is required");
    if (title.length > 200) throw new Error("project title is too long");
    await ctx.tx.query(
      `UPDATE project SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [title, epochNow(), args.projectId],
    );
    return {
      result: undefined,
      changes: [{ table: "project", op: "update", id: args.projectId }],
    };
  },
};

export interface ProjectIdArgs {
  projectId: UUID;
}

/**
 * Soft-deletes a book, exactly like every other entity: the row stays, `deleted_at` hides it, and
 * `restoreProject` brings it back. Its scenes and characters are untouched — deleting the only
 * book leaves a library that offers "Start your story", which is a state the app already handles.
 */
export const deleteProject: Command<ProjectIdArgs, void> = {
  name: "project.delete",
  async run(ctx, args) {
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE project SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [now, now, args.projectId],
    );
    return {
      result: undefined,
      changes: [{ table: "project", op: "delete", id: args.projectId }],
    };
  },
};

/** The undo half of a delete; the toast in the UI is the only caller. */
export const restoreProject: Command<ProjectIdArgs, void> = {
  name: "project.restore",
  async run(ctx, args) {
    await ctx.tx.query(`UPDATE project SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [
      epochNow(),
      args.projectId,
    ]);
    return {
      result: undefined,
      changes: [{ table: "project", op: "update", id: args.projectId }],
    };
  },
};

export interface SaveStepContentArgs {
  projectId: UUID;
  step: SnowflakeStepNumber;
  content: SnowflakeStepContent;
}

export interface SaveStepContentResult {
  status: StepStatus;
  issues: ValidationIssue[];
}

/**
 * Persists step content and derives the status (spec §3.4.1 state machine):
 * cleared content → not_started; a completed step that gains an error is auto-demoted
 * to in_progress; anything else with content is in_progress.
 */
export const saveStepContent: Command<SaveStepContentArgs, SaveStepContentResult> = {
  name: "snowflake.saveStepContent",
  async run(ctx, args) {
    const row = (
      await ctx.tx.query<{ id: string; status: StepStatus }>(
        `SELECT id, status FROM snowflake_step WHERE project_id = ? AND step = ?`,
        [args.projectId, args.step],
      )
    )[0];
    if (!row) throw new Error(`snowflake step ${args.step} not found for this project`);
    const now = epochNow();
    const context = await validationContext(ctx, args.projectId);
    const issues = validateStep(args.step, args.content, context);
    const empty = isEffectivelyEmpty(args.step, args.content, context);
    const status = nextStatus(row.status, empty, issues);
    await ctx.tx.query(
      `UPDATE snowflake_step
          SET content = ?, status = ?,
              completed_at = CASE WHEN ? = 'complete' THEN COALESCE(completed_at, ?) ELSE NULL END,
              updated_at = ?
        WHERE project_id = ? AND step = ?`,
      [JSON.stringify(args.content), status, status, now, now, args.projectId, args.step],
    );
    return {
      result: { status, issues },
      changes: [{ table: "snowflake_step", op: "update", id: row.id, parentIds: [args.projectId] }],
    };
  },
};

function nextStatus(
  current: StepStatus,
  empty: boolean,
  issues: readonly ValidationIssue[],
): StepStatus {
  if (empty) return "not_started";
  if (current === "complete" && blockingIssues(issues).length > 0) return "in_progress";
  if (current === "complete") return "complete";
  return "in_progress";
}

/**
 * Step 8's artifact is the `scene` table, so its bookkeeping content may still be empty
 * while the step is clearly underway (scenes created from the Scenes tab or a single row).
 */
function isEffectivelyEmpty(
  step: SnowflakeStepNumber,
  content: SnowflakeStepContent,
  context: { scenes: readonly SceneContextInfo[] },
): boolean {
  if (step === 8 && context.scenes.length > 0) return false;
  return isStepContentEmpty(step, content);
}

export interface MarkStepCompleteArgs {
  projectId: UUID;
  step: SnowflakeStepNumber;
  /** Warning codes the user chose to ignore — recorded for provenance, never blocking. */
  overrides?: readonly string[];
}

/** Requires zero blocking errors; empty content is blocked by a synthetic STEP_EMPTY issue. */
export const markStepComplete: Command<MarkStepCompleteArgs, { completedAt: number }> = {
  name: "snowflake.markStepComplete",
  async run(ctx, args) {
    const row = (
      await ctx.tx.query<{ id: string; content: string }>(
        `SELECT id, content FROM snowflake_step WHERE project_id = ? AND step = ?`,
        [args.projectId, args.step],
      )
    )[0];
    if (!row) throw new Error(`snowflake step ${args.step} not found for this project`);
    const content = parseJson<SnowflakeStepContent>(row.content, emptyStepContent(args.step));
    const context = await validationContext(ctx, args.projectId);
    const issues = isEffectivelyEmpty(args.step, content, context)
      ? [
          {
            code: "STEP_EMPTY",
            severity: "error" as const,
            message: "issues.STEP_EMPTY",
          },
        ]
      : validateStep(args.step, content, context);
    const blocking = blockingIssues(issues);
    if (blocking.length > 0) throw new StepBlockedError(blocking);
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE snowflake_step
          SET status = 'complete', completed_at = ?, overrides = ?, updated_at = ?
        WHERE project_id = ? AND step = ?`,
      [now, JSON.stringify([...(args.overrides ?? [])]), now, args.projectId, args.step],
    );
    return {
      result: { completedAt: now },
      changes: [{ table: "snowflake_step", op: "update", id: row.id, parentIds: [args.projectId] }],
    };
  },
};

/**
 * Validation context: names+aliases (S1), quartet+storyline (S3/S5), step-3 majors, and the
 * light scene slice (S8 — its artifact is the `scene` table, not the step content).
 */
async function validationContext(
  ctx: CommandContext,
  projectId: UUID,
): Promise<{
  characterNames: string[];
  characters: CharacterContextInfo[];
  majorCharacterIds: UUID[];
  scenes: SceneContextInfo[];
}> {
  const rows = await ctx.tx.query<{
    id: string;
    name: string;
    aliases: string;
    role: string;
    motivation: string;
    goal: string;
    conflict: string;
    epiphany: string;
    storyline_text: string;
  }>(
    `SELECT id, name, aliases, role, motivation, goal, conflict, epiphany, storyline_text
       FROM character WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  );
  const characterNames: string[] = [];
  const characters: CharacterContextInfo[] = [];
  for (const row of rows) {
    characterNames.push(row.name);
    for (const alias of parseJson<unknown[]>(row.aliases, [])) {
      if (typeof alias === "string") characterNames.push(alias);
    }
    characters.push({
      id: row.id as UUID,
      role: row.role as CharacterRole,
      motivation: row.motivation,
      goal: row.goal,
      conflict: row.conflict,
      epiphany: row.epiphany,
      storyline: row.storyline_text,
    });
  }
  const step3Row = (
    await ctx.tx.query<{ content: string }>(
      `SELECT content FROM snowflake_step WHERE project_id = ? AND step = 3`,
      [projectId],
    )
  )[0];
  const majorCharacterIds =
    parseJson<{ majorCharacterIds?: UUID[] }>(step3Row?.content ?? "", {}).majorCharacterIds ?? [];
  const scenes = await listSceneContext(ctx.tx, projectId);
  return { characterNames, characters, majorCharacterIds, scenes };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // malformed JSON never reaches here through our own writes; stay defensive
  }
}
