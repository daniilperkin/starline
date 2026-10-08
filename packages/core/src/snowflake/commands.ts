import type { ChangeEvent } from "../changes";
import type { Command, CommandContext } from "../commands";
import type {
  PlanningMethod,
  SnowflakeStepNumber,
  StepStatus,
  StoryForm,
  ValidationIssue,
} from "../entities";
import { epochNow, newUuid, type UUID } from "../primitives";
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
    const issues = validateStep(args.step, args.content, {
      characterNames: await characterNames(ctx, args.projectId),
    });
    const status = nextStatus(row.status, args.step, args.content, issues);
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
  step: SnowflakeStepNumber,
  content: SnowflakeStepContent,
  issues: readonly ValidationIssue[],
): StepStatus {
  if (isStepContentEmpty(step, content)) return "not_started";
  if (current === "complete" && blockingIssues(issues).length > 0) return "in_progress";
  if (current === "complete") return "complete";
  return "in_progress";
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
    const issues = isStepContentEmpty(args.step, content)
      ? [
          {
            code: "STEP_EMPTY",
            severity: "error" as const,
            message: "issues.STEP_EMPTY",
          },
        ]
      : validateStep(args.step, content, {
          characterNames: await characterNames(ctx, args.projectId),
        });
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

/** Known character names + aliases, feeding the S1_HAS_NAMES heuristic. */
async function characterNames(ctx: CommandContext, projectId: UUID): Promise<string[]> {
  const rows = await ctx.tx.query<{ name: string; aliases: string }>(
    `SELECT name, aliases FROM character WHERE project_id = ? AND deleted_at IS NULL`,
    [projectId],
  );
  const names: string[] = [];
  for (const row of rows) {
    names.push(row.name);
    for (const alias of parseJson<unknown[]>(row.aliases, [])) {
      if (typeof alias === "string") names.push(alias);
    }
  }
  return names;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // malformed JSON never reaches here through our own writes; stay defensive
  }
}
