import type { ChangeEvent } from "../changes";
import type { Command } from "../commands";
import type { SceneOutcome, SceneStatus, TimeOfDay } from "../entities";
import { syncMentions } from "../lore/mentions";
import { epochNow, newUuid, type OrderKey, orderKeyBetween, type UUID } from "../primitives";
import { EMPTY_RICH_TEXT, type RichText, richTextFromPlain } from "../richtext";
import { parseSceneList } from "./parse";
import {
  PLOTLINE_KIND_COLORS,
  PLOTLINE_KINDS,
  type PlotlineKind,
  SCENE_OUTCOMES,
  SCENE_STATUSES,
  type SceneDraft,
  type SnowflakeSource,
  TIME_OF_DAY_OPTIONS,
  tagColorFor,
} from "./types";

/** Whitelisted column map for `updateScene` — the only fields v1 forms may write. */
const UPDATABLE_COLUMNS: Record<keyof SceneDraft, string> = {
  title: "title",
  status: "status",
  povCharacterId: "pov_character_id",
  locationId: "location_id",
  objective: "objective",
  obstacle: "obstacle",
  outcome: "outcome",
  outcomeNote: "outcome_note",
  emotionStart: "emotion_start",
  emotionEnd: "emotion_end",
  storyTime: "story_time",
  storyTimeLabel: "story_time_label",
  timeOfDay: "time_of_day",
  targetWordCount: "target_word_count",
};

export interface CreateSceneArgs {
  projectId: UUID;
  /** null = the Unassigned pool. */
  chapterId?: UUID | null;
  title?: string;
  synopsis?: RichText;
  povCharacterId?: UUID | null;
  targetWordCount?: number | null;
  source?: SnowflakeSource | null;
}

/** Adds one scene at the end of its chapter (or the Unassigned pool). */
export const createScene: Command<CreateSceneArgs, { sceneId: UUID }> = {
  name: "scene.create",
  async run(ctx, args) {
    const chapterId = args.chapterId ?? null;
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM scene
        WHERE project_id = ? AND chapter_id IS ? AND deleted_at IS NULL
        ORDER BY order_key DESC LIMIT 1`,
      [args.projectId, chapterId],
    );
    const orderKey = orderKeyBetween(last[0]?.order_key ?? null, null);
    const sceneId = newUuid();
    const now = epochNow();
    const synopsis = args.synopsis ?? EMPTY_RICH_TEXT;
    await ctx.tx.query(
      `INSERT INTO scene (id, project_id, chapter_id, order_key, title, synopsis_json, synopsis_text,
                          pov_character_id, target_word_count, snowflake_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sceneId,
        args.projectId,
        chapterId,
        orderKey,
        (args.title ?? "").trim(),
        synopsis.json === null ? null : JSON.stringify(synopsis.json),
        synopsis.text,
        args.povCharacterId ?? null,
        args.targetWordCount ?? null,
        args.source ? JSON.stringify(args.source) : null,
        now,
        now,
      ],
    );
    return {
      result: { sceneId },
      changes: [{ table: "scene", op: "insert", id: sceneId, parentIds: [args.projectId] }],
    };
  },
};

export type ScenePatch = Partial<SceneDraft> & {
  /** The step-8/9 description — written as both `synopsis_json` and `synopsis_text`. */
  synopsis?: RichText;
};

export interface UpdateSceneArgs {
  projectId: UUID;
  sceneId: UUID;
  patch: ScenePatch;
}

export const updateScene: Command<UpdateSceneArgs, void> = {
  name: "scene.update",
  async run(ctx, args) {
    const { synopsis, ...draftPatch } = args.patch;
    const entries = Object.entries(draftPatch) as Array<[keyof SceneDraft, unknown]>;
    if (entries.length === 0 && synopsis === undefined) throw new Error("empty scene patch");
    for (const [key, value] of entries) {
      switch (key) {
        case "status":
          if (!SCENE_STATUSES.includes(value as SceneStatus))
            throw new Error(`unknown status: ${String(value)}`);
          break;
        case "outcome":
          if (!SCENE_OUTCOMES.includes(value as SceneOutcome))
            throw new Error(`unknown outcome: ${String(value)}`);
          break;
        case "timeOfDay":
          if (!TIME_OF_DAY_OPTIONS.includes(value as TimeOfDay))
            throw new Error(`unknown time of day: ${String(value)}`);
          break;
        case "targetWordCount":
          if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) {
            throw new Error("targetWordCount must be a non-negative integer or null");
          }
          break;
        case "storyTime":
          if (value !== null && !Number.isFinite(value))
            throw new Error("storyTime must be finite or null");
          break;
        default:
          break;
      }
    }
    const sets = entries.map(([key]) => `${UPDATABLE_COLUMNS[key]} = ?`);
    const params: Array<string | number | null> = entries.map(
      ([, value]) => value as string | number | null,
    );
    if (draftPatch.title !== undefined) {
      const index = entries.findIndex(([key]) => key === "title");
      params[index] = (draftPatch.title as string).trim();
    }
    if (synopsis !== undefined) {
      sets.push("synopsis_json = ?", "synopsis_text = ?");
      params.push(synopsis.json === null ? null : JSON.stringify(synopsis.json), synopsis.text);
    }
    params.push(epochNow(), args.sceneId, args.projectId);
    await ctx.tx.query(
      `UPDATE scene SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    // Mirror the synopsis's mention chips (spec §3.9) — backlinks read this, not the JSON.
    if (synopsis !== undefined) {
      await syncMentions(ctx.tx, "scene", args.sceneId, "synopsis", synopsis.json);
    }
    return {
      result: undefined,
      changes: [{ table: "scene", op: "update", id: args.sceneId, parentIds: [args.projectId] }],
    };
  },
};

export interface DeleteSceneArgs {
  projectId: UUID;
  sceneId: UUID;
}

/** Soft delete (spec §5.3 trash semantics; the Trash screen arrives with Slice 5). */
export const deleteScene: Command<DeleteSceneArgs, void> = {
  name: "scene.delete",
  async run(ctx, args) {
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE scene SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.sceneId, args.projectId],
    );
    return {
      result: undefined,
      changes: [{ table: "scene", op: "delete", id: args.sceneId, parentIds: [args.projectId] }],
    };
  },
};

export interface MoveSceneArgs {
  projectId: UUID;
  sceneId: UUID;
  /** Target chapter (null = the Unassigned pool). Ignored when `beforeSceneId` is set. */
  chapterId: UUID | null;
  /** Insert directly before this scene (its chapter wins); null = append at the end. */
  beforeSceneId: UUID | null;
}

/** Reorder / reassign: writes one row (`chapter_id`, `order_key`), spec §3.6 invariant 4. */
export const moveScene: Command<MoveSceneArgs, void> = {
  name: "scene.move",
  async run(ctx, args) {
    const moved = (
      await ctx.tx.query<{ id: string }>(
        `SELECT id FROM scene WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
        [args.sceneId, args.projectId],
      )
    )[0];
    if (!moved) throw new Error("scene not found");

    let targetChapterId = args.chapterId;
    let previous: string | null = null;
    let next: string | null = null;
    if (args.beforeSceneId !== null) {
      const before = (
        await ctx.tx.query<{ order_key: string; chapter_id: string | null }>(
          `SELECT order_key, chapter_id FROM scene
            WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
          [args.beforeSceneId, args.projectId],
        )
      )[0];
      if (!before) throw new Error("target scene not found");
      targetChapterId = before.chapter_id as UUID | null;
      next = before.order_key;
      const prevRow = (
        await ctx.tx.query<{ order_key: string }>(
          `SELECT order_key FROM scene
            WHERE project_id = ? AND chapter_id IS ? AND deleted_at IS NULL
              AND order_key < ? AND id != ?
            ORDER BY order_key DESC LIMIT 1`,
          [args.projectId, targetChapterId, before.order_key, args.sceneId],
        )
      )[0];
      previous = prevRow?.order_key ?? null;
    } else {
      const lastRow = (
        await ctx.tx.query<{ order_key: string }>(
          `SELECT order_key FROM scene
            WHERE project_id = ? AND chapter_id IS ? AND deleted_at IS NULL AND id != ?
            ORDER BY order_key DESC LIMIT 1`,
          [args.projectId, targetChapterId, args.sceneId],
        )
      )[0];
      previous = lastRow?.order_key ?? null;
    }
    const orderKey = orderKeyBetween(previous, next);
    await ctx.tx.query(
      `UPDATE scene SET chapter_id = ?, order_key = ?, updated_at = ?
        WHERE id = ? AND project_id = ?`,
      [targetChapterId, orderKey, epochNow(), args.sceneId, args.projectId],
    );
    return {
      result: undefined,
      changes: [{ table: "scene", op: "update", id: args.sceneId, parentIds: [args.projectId] }],
    };
  },
};

export interface SetScenePlacementArgs {
  projectId: UUID;
  sceneId: UUID;
  chapterId: UUID | null;
  orderKey: OrderKey;
}

/**
 * Writes exactly `chapter_id` + `order_key` on one row — the undo inverse of a move
 * (`moveScene` computes a fresh key; this restores the captured one, spec §3.6 invariant 4).
 */
export const setScenePlacement: Command<SetScenePlacementArgs, void> = {
  name: "scene.setPlacement",
  async run(ctx, args) {
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE scene SET chapter_id = ?, order_key = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.chapterId, args.orderKey, now, args.sceneId, args.projectId],
    );
    return {
      result: undefined,
      changes: [{ table: "scene", op: "update", id: args.sceneId, parentIds: [args.projectId] }],
    };
  },
};

export interface CopyLineToSceneSynopsisArgs {
  projectId: UUID;
  sceneId: UUID;
}

export interface CopyLineToSceneSynopsisResult {
  copied: boolean;
  alreadyPresent: boolean;
}

/** First block of a plain-text projection (blocks are single-newline separated, richtext.ts). */
function firstParagraph(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * Step-9 trigger "Copy to scene synopsis" (spec §3.4.3): the scene's original step-8 line
 * becomes the **first paragraph** of the synopsis; existing paragraphs stay below it, so the
 * action never destroys text. No-op when the synopsis already opens with that line (which is
 * the state right after a step-8 paste — the one-liner is the synopsis at import time).
 */
export const copyLineToSceneSynopsis: Command<
  CopyLineToSceneSynopsisArgs,
  CopyLineToSceneSynopsisResult
> = {
  name: "scene.copyLineToSynopsis",
  async run(ctx, args) {
    const row = (
      await ctx.tx.query<{
        title: string;
        synopsis_json: string | null;
        synopsis_text: string;
        snowflake_source: string | null;
      }>(
        `SELECT title, synopsis_json, synopsis_text, snowflake_source FROM scene
          WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
        [args.sceneId, args.projectId],
      )
    )[0];
    if (!row) throw new Error("scene not found");
    const source = parseJson<SnowflakeSource | null>(row.snowflake_source, null);
    // Scenes pasted before the oneLine field existed fall back to the synopsis's opening line.
    const line =
      (source?.oneLine ?? "").trim() || firstParagraph(row.synopsis_text) || row.title.trim();
    if (line.length === 0) throw new Error("no step-8 line to copy");
    const existing = row.synopsis_text.trim();
    if (existing.length > 0 && firstParagraph(existing) === line) {
      return { result: { copied: false, alreadyPresent: true }, changes: [] };
    }
    const now = epochNow();
    const doc = parseJson<{ type?: string; content?: unknown[] } | null>(row.synopsis_json, null);
    let synopsisJson: string | null;
    let synopsisText: string;
    if (doc !== null && Array.isArray(doc.content)) {
      const paragraph = { type: "paragraph", content: [{ type: "text", text: line }] };
      synopsisJson = JSON.stringify({ ...doc, type: "doc", content: [paragraph, ...doc.content] });
      synopsisText = existing.length > 0 ? `${line}\n${existing}` : line;
    } else {
      const built = richTextFromPlain(existing.length > 0 ? `${line}\n${existing}` : line);
      synopsisJson = built.json === null ? null : JSON.stringify(built.json);
      synopsisText = built.text;
    }
    await ctx.tx.query(
      `UPDATE scene SET synopsis_json = ?, synopsis_text = ?, updated_at = ?
        WHERE id = ? AND project_id = ?`,
      [synopsisJson, synopsisText, now, args.sceneId, args.projectId],
    );
    return {
      result: { copied: true, alreadyPresent: false },
      changes: [{ table: "scene", op: "update", id: args.sceneId, parentIds: [args.projectId] }],
    };
  },
};

export interface CreateScenesFromListArgs {
  projectId: UUID;
  /** The pasted step-8 list (TSV/CSV-ish/plain lines — see parseSceneList). */
  text: string;
}

export interface CreateScenesFromListResult {
  created: number;
  updated: number;
  skipped: number;
  sceneIds: UUID[];
}

/**
 * Step 8 "Create scenes from list" (spec §4.1 point 7 + edge case 10): parses the paste,
 * resolves POV names and chapter titles, and creates the scenes — or **merges** into the
 * scene that already carries the same `snowflakeSource.line`, so a re-import never
 * duplicates. Missing chapters are created on the fly. The step-8 bookkeeping row
 * (`generatedSceneIds`, `lastImportedAt`) is updated in the same transaction.
 */
export const createScenesFromList: Command<CreateScenesFromListArgs, CreateScenesFromListResult> = {
  name: "scene.createFromList",
  async run(ctx, args) {
    const characters = await ctx.tx.query<{ id: string; name: string; aliases: string }>(
      `SELECT id, name, aliases FROM character WHERE project_id = ? AND deleted_at IS NULL`,
      [args.projectId],
    );
    const nameToId = new Map<string, UUID>();
    for (const character of characters) {
      nameToId.set(character.name.trim().toLowerCase(), character.id as UUID);
      for (const alias of parseJson<string[]>(character.aliases, [])) {
        nameToId.set(alias.trim().toLowerCase(), character.id as UUID);
      }
    }
    const parsed = parseSceneList(args.text, { knownNames: [...nameToId.keys()] });

    const sourced = await ctx.tx.query<{ id: string; snowflake_source: string }>(
      `SELECT id, snowflake_source FROM scene
        WHERE project_id = ? AND deleted_at IS NULL AND snowflake_source IS NOT NULL`,
      [args.projectId],
    );
    const byLine = new Map<number, UUID>();
    for (const row of sourced) {
      const source = parseJson<SnowflakeSource | null>(row.snowflake_source, null);
      if (source !== null && source.step === 8) byLine.set(source.line, row.id as UUID);
    }

    const chapterRows = await ctx.tx.query<{ id: string; title: string; order_key: string }>(
      `SELECT id, title, order_key FROM chapter
        WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key`,
      [args.projectId],
    );
    const chapterByTitle = new Map(
      chapterRows.map((row) => [row.title.trim().toLowerCase(), row.id as UUID]),
    );
    let lastChapterKey: string | null = chapterRows.at(-1)?.order_key ?? null;

    const changes: ChangeEvent[] = [];
    const now = epochNow();
    const sceneIds: UUID[] = [];
    let created = 0;
    let updated = 0;
    // Tracks the running end of each chapter scope so appended keys stay strictly increasing.
    const lastKeyByScope = new Map<string, string | null>();

    for (const row of parsed.rows) {
      const povId =
        row.povName === null ? null : (nameToId.get(row.povName.trim().toLowerCase()) ?? null);
      let chapterId: UUID | null = null;
      if (row.chapterTitle !== null) {
        const key = row.chapterTitle.trim().toLowerCase();
        let id = chapterByTitle.get(key);
        if (id === undefined) {
          id = newUuid();
          lastChapterKey = orderKeyBetween(lastChapterKey, null);
          await ctx.tx.query(
            `INSERT INTO chapter (id, project_id, part_id, title, order_key, created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?, ?, ?)`,
            [id, args.projectId, row.chapterTitle.trim(), lastChapterKey, now, now],
          );
          chapterByTitle.set(key, id);
          changes.push({ table: "chapter", op: "insert", id, parentIds: [args.projectId] });
        }
        chapterId = id;
      }

      const mergeId = byLine.get(row.line);
      if (mergeId !== undefined) {
        const synopsis = richTextFromPlain(row.oneLine);
        const sets = ["synopsis_json = ?", "synopsis_text = ?", "updated_at = ?"];
        const params: Array<string | number | null> = [
          synopsis.json === null ? null : JSON.stringify(synopsis.json),
          synopsis.text,
          now,
        ];
        if (row.estWords !== null) {
          sets.push("target_word_count = ?");
          params.push(row.estWords);
        }
        if (povId !== null) {
          sets.push("pov_character_id = ?");
          params.push(povId);
        }
        if (chapterId !== null) {
          sets.push("chapter_id = ?");
          params.push(chapterId);
        }
        params.push(mergeId, args.projectId);
        await ctx.tx.query(
          `UPDATE scene SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`,
          params,
        );
        changes.push({ table: "scene", op: "update", id: mergeId, parentIds: [args.projectId] });
        sceneIds.push(mergeId);
        updated++;
        continue;
      }

      const scopeKey = chapterId ?? "";
      if (!lastKeyByScope.has(scopeKey)) {
        const lastRow = (
          await ctx.tx.query<{ order_key: string }>(
            `SELECT order_key FROM scene
              WHERE project_id = ? AND chapter_id IS ? AND deleted_at IS NULL
              ORDER BY order_key DESC LIMIT 1`,
            [args.projectId, chapterId],
          )
        )[0];
        lastKeyByScope.set(scopeKey, lastRow?.order_key ?? null);
      }
      const orderKey = orderKeyBetween(lastKeyByScope.get(scopeKey) ?? null, null);
      lastKeyByScope.set(scopeKey, orderKey);
      const sceneId = newUuid();
      const synopsis = richTextFromPlain(row.oneLine);
      await ctx.tx.query(
        `INSERT INTO scene (id, project_id, chapter_id, order_key, title, synopsis_json, synopsis_text,
                            pov_character_id, target_word_count, snowflake_source, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
        [
          sceneId,
          args.projectId,
          chapterId,
          orderKey,
          synopsis.json === null ? null : JSON.stringify(synopsis.json),
          synopsis.text,
          povId,
          row.estWords,
          JSON.stringify({
            step: 8,
            line: row.line,
            oneLine: row.oneLine,
          } satisfies SnowflakeSource),
          now,
          now,
        ],
      );
      changes.push({ table: "scene", op: "insert", id: sceneId, parentIds: [args.projectId] });
      sceneIds.push(sceneId);
      byLine.set(row.line, sceneId);
      created++;
    }

    // Step-8 bookkeeping, atomically with the import (drives the stale badge vs step 6).
    const stepRow = (
      await ctx.tx.query<{ id: string; status: string; content: string }>(
        `SELECT id, status, content FROM snowflake_step WHERE project_id = ? AND step = 8`,
        [args.projectId],
      )
    )[0];
    if (stepRow) {
      const content = parseJson<{ generatedSceneIds?: string[] }>(stepRow.content, {});
      const ids = new Set<string>([...(content.generatedSceneIds ?? []), ...sceneIds]);
      const status = stepRow.status === "not_started" ? "in_progress" : stepRow.status;
      await ctx.tx.query(
        `UPDATE snowflake_step SET content = ?, status = ?, updated_at = ? WHERE id = ?`,
        [
          JSON.stringify({ generatedSceneIds: [...ids], lastImportedAt: now }),
          status,
          now,
          stepRow.id,
        ],
      );
      changes.push({
        table: "snowflake_step",
        op: "update",
        id: stepRow.id,
        parentIds: [args.projectId],
      });
    }

    return { result: { created, updated, skipped: parsed.skipped.length, sceneIds }, changes };
  },
};

export interface CreateChapterArgs {
  projectId: UUID;
  partId?: UUID | null;
  title?: string;
}

export const createChapter: Command<CreateChapterArgs, { chapterId: UUID }> = {
  name: "chapter.create",
  async run(ctx, args) {
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM chapter
        WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key DESC LIMIT 1`,
      [args.projectId],
    );
    const count =
      (
        await ctx.tx.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM chapter WHERE project_id = ? AND deleted_at IS NULL`,
          [args.projectId],
        )
      )[0]?.n ?? 0;
    const orderKey = orderKeyBetween(last[0]?.order_key ?? null, null);
    const chapterId = newUuid();
    const now = epochNow();
    const title = (args.title ?? "").trim() || `Chapter ${count + 1}`;
    await ctx.tx.query(
      `INSERT INTO chapter (id, project_id, part_id, title, order_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [chapterId, args.projectId, args.partId ?? null, title, orderKey, now, now],
    );
    return {
      result: { chapterId },
      changes: [{ table: "chapter", op: "insert", id: chapterId, parentIds: [args.projectId] }],
    };
  },
};

export interface UpdateChapterArgs {
  projectId: UUID;
  chapterId: UUID;
  patch: { title?: string; color?: string | null };
}

export const updateChapter: Command<UpdateChapterArgs, void> = {
  name: "chapter.update",
  async run(ctx, args) {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (args.patch.title !== undefined) {
      const title = args.patch.title.trim();
      if (title.length === 0) throw new Error("chapter title is required");
      sets.push("title = ?");
      params.push(title);
    }
    if (args.patch.color !== undefined) {
      if (args.patch.color !== null && !/^#[0-9a-fA-F]{6}$/.test(args.patch.color)) {
        throw new Error(`invalid colour: ${args.patch.color}`);
      }
      sets.push("color = ?");
      params.push(args.patch.color);
    }
    if (sets.length === 0) throw new Error("empty chapter patch");
    params.push(epochNow(), args.chapterId, args.projectId);
    await ctx.tx.query(
      `UPDATE chapter SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    return {
      result: undefined,
      changes: [
        { table: "chapter", op: "update", id: args.chapterId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface MoveChapterArgs {
  projectId: UUID;
  chapterId: UUID;
  /** Insert directly before this chapter; null = move to the end. */
  beforeChapterId: UUID | null;
}

export const moveChapter: Command<MoveChapterArgs, void> = {
  name: "chapter.move",
  async run(ctx, args) {
    let previous: string | null = null;
    let next: string | null = null;
    if (args.beforeChapterId !== null) {
      const before = (
        await ctx.tx.query<{ order_key: string }>(
          `SELECT order_key FROM chapter
            WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
          [args.beforeChapterId, args.projectId],
        )
      )[0];
      if (!before) throw new Error("target chapter not found");
      next = before.order_key;
      const prevRow = (
        await ctx.tx.query<{ order_key: string }>(
          `SELECT order_key FROM chapter
            WHERE project_id = ? AND deleted_at IS NULL AND order_key < ? AND id != ?
            ORDER BY order_key DESC LIMIT 1`,
          [args.projectId, before.order_key, args.chapterId],
        )
      )[0];
      previous = prevRow?.order_key ?? null;
    } else {
      const lastRow = (
        await ctx.tx.query<{ order_key: string }>(
          `SELECT order_key FROM chapter
            WHERE project_id = ? AND deleted_at IS NULL AND id != ?
            ORDER BY order_key DESC LIMIT 1`,
          [args.projectId, args.chapterId],
        )
      )[0];
      previous = lastRow?.order_key ?? null;
    }
    const orderKey = orderKeyBetween(previous, next);
    await ctx.tx.query(
      `UPDATE chapter SET order_key = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
      [orderKey, epochNow(), args.chapterId, args.projectId],
    );
    return {
      result: undefined,
      changes: [
        { table: "chapter", op: "update", id: args.chapterId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface DeleteChapterArgs {
  projectId: UUID;
  chapterId: UUID;
}

/** Soft-deletes the chapter; its scenes drop into the Unassigned pool (spec §3.12). */
export const deleteChapter: Command<DeleteChapterArgs, void> = {
  name: "chapter.delete",
  async run(ctx, args) {
    const now = epochNow();
    const sceneRows = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM scene WHERE chapter_id = ? AND deleted_at IS NULL`,
      [args.chapterId],
    );
    await ctx.tx.query(
      `UPDATE chapter SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.chapterId, args.projectId],
    );
    await ctx.tx.query(
      `UPDATE scene SET chapter_id = NULL, updated_at = ? WHERE chapter_id = ? AND deleted_at IS NULL`,
      [now, args.chapterId],
    );
    const changes: ChangeEvent[] = [
      { table: "chapter", op: "delete", id: args.chapterId, parentIds: [args.projectId] },
    ];
    for (const scene of sceneRows) {
      changes.push({ table: "scene", op: "update", id: scene.id, parentIds: [args.projectId] });
    }
    return { result: undefined, changes };
  },
};

export interface CreatePlotlineArgs {
  projectId: UUID;
  name: string;
  kind?: PlotlineKind;
}

export const createPlotline: Command<CreatePlotlineArgs, { plotlineId: UUID }> = {
  name: "plotline.create",
  async run(ctx, args) {
    const name = args.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new Error("plotline name must be 1–120 characters");
    }
    const kind = args.kind ?? "subplot";
    if (!PLOTLINE_KINDS.includes(kind)) throw new Error(`unknown plotline kind: ${kind}`);
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM plotline
        WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key DESC LIMIT 1`,
      [args.projectId],
    );
    const orderKey = orderKeyBetween(last[0]?.order_key ?? null, null);
    const plotlineId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO plotline (id, project_id, name, description_json, description_text, color,
                             order_key, kind, character_id, created_at, updated_at)
       VALUES (?, ?, ?, NULL, '', ?, ?, ?, NULL, ?, ?)`,
      [plotlineId, args.projectId, name, PLOTLINE_KIND_COLORS[kind], orderKey, kind, now, now],
    );
    return {
      result: { plotlineId },
      changes: [{ table: "plotline", op: "insert", id: plotlineId, parentIds: [args.projectId] }],
    };
  },
};

export interface SetSceneCharactersArgs {
  projectId: UUID;
  sceneId: UUID;
  /** The full set of present characters; the POV character is always kept. */
  characterIds: UUID[];
}

/** Replaces the scene's "present" cast; the POV row is protected (spec §3.6 invariant 1). */
export const setSceneCharacters: Command<SetSceneCharactersArgs, void> = {
  name: "scene.setCharacters",
  async run(ctx, args) {
    const scene = (
      await ctx.tx.query<{ pov_character_id: string | null }>(
        `SELECT pov_character_id FROM scene WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
        [args.sceneId, args.projectId],
      )
    )[0];
    if (!scene) throw new Error("scene not found");
    const wanted = new Set(args.characterIds);
    if (scene.pov_character_id !== null) wanted.add(scene.pov_character_id as UUID);
    const valid = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM character WHERE project_id = ? AND id IN (${[...wanted].map(() => "?").join(", ") || "NULL"})`,
      [args.projectId, ...wanted],
    );
    await ctx.tx.query(`DELETE FROM scene_character WHERE scene_id = ? AND character_id IS NOT ?`, [
      args.sceneId,
      scene.pov_character_id,
    ]);
    for (const row of valid) {
      await ctx.tx.query(
        `INSERT OR IGNORE INTO scene_character (scene_id, character_id, presence) VALUES (?, ?, 'present')`,
        [args.sceneId, row.id],
      );
    }
    return {
      result: undefined,
      changes: [
        { table: "scene_character", op: "update", id: args.sceneId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface SetScenePlotlineArgs {
  projectId: UUID;
  sceneId: UUID;
  plotlineId: UUID;
  attached: boolean;
  beat?: string;
}

export const setScenePlotline: Command<SetScenePlotlineArgs, void> = {
  name: "scene.setPlotline",
  async run(ctx, args) {
    if (args.attached) {
      const beat = (args.beat ?? "").trim();
      if (beat.length > 120) throw new Error("beat must be ≤ 120 characters");
      await ctx.tx.query(
        `INSERT INTO scene_plotline (scene_id, plotline_id, beat) VALUES (?, ?, ?)
         ON CONFLICT (scene_id, plotline_id) DO UPDATE SET beat = excluded.beat`,
        [args.sceneId, args.plotlineId, beat],
      );
    } else {
      await ctx.tx.query(`DELETE FROM scene_plotline WHERE scene_id = ? AND plotline_id = ?`, [
        args.sceneId,
        args.plotlineId,
      ]);
    }
    return {
      result: undefined,
      changes: [
        { table: "scene_plotline", op: "update", id: args.sceneId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface SetSceneTagsArgs {
  projectId: UUID;
  sceneId: UUID;
  /** Tag names; unknown names create new tags (the tag manager arrives with Slice 9). */
  names: string[];
}

export const setSceneTags: Command<SetSceneTagsArgs, void> = {
  name: "scene.setTags",
  async run(ctx, args) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const raw of args.names) {
      const name = raw.trim().slice(0, 60);
      const key = name.toLowerCase();
      if (name.length === 0 || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (names.length >= 20) break;
    }
    const existing = await ctx.tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM tag WHERE project_id = ?`,
      [args.projectId],
    );
    const byName = new Map(existing.map((row) => [row.name.trim().toLowerCase(), row.id as UUID]));
    const changes: ChangeEvent[] = [];
    const now = epochNow();
    const tagIds: UUID[] = [];
    for (const name of names) {
      let id = byName.get(name.toLowerCase());
      if (id === undefined) {
        id = newUuid();
        await ctx.tx.query(
          `INSERT INTO tag (id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`,
          [id, args.projectId, name, tagColorFor(name), now],
        );
        byName.set(name.toLowerCase(), id);
        changes.push({ table: "tag", op: "insert", id, parentIds: [args.projectId] });
      }
      tagIds.push(id);
    }
    await ctx.tx.query(`DELETE FROM entity_tag WHERE entity_type = 'scene' AND entity_id = ?`, [
      args.sceneId,
    ]);
    for (const tagId of tagIds) {
      await ctx.tx.query(
        `INSERT INTO entity_tag (tag_id, entity_type, entity_id) VALUES (?, 'scene', ?)`,
        [tagId, args.sceneId],
      );
    }
    changes.push({
      table: "entity_tag",
      op: "update",
      id: args.sceneId,
      parentIds: [args.projectId],
    });
    return { result: undefined, changes };
  },
};

export interface SetSceneLoreArgs {
  projectId: UUID;
  sceneId: UUID;
  loreIds: UUID[];
}

/** Replaces the scene's "lore touched" set (the lore picker fills in with the World slice). */
export const setSceneLore: Command<SetSceneLoreArgs, void> = {
  name: "scene.setLore",
  async run(ctx, args) {
    await ctx.tx.query(`DELETE FROM scene_lore WHERE scene_id = ?`, [args.sceneId]);
    for (const loreId of new Set(args.loreIds)) {
      await ctx.tx.query(
        `INSERT OR IGNORE INTO scene_lore (scene_id, lore_entry_id) VALUES (?, ?)`,
        [args.sceneId, loreId],
      );
    }
    return {
      result: undefined,
      changes: [
        { table: "scene_lore", op: "update", id: args.sceneId, parentIds: [args.projectId] },
      ],
    };
  },
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}
