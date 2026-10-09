import type { ChangeEvent } from "../changes";
import type { Command } from "../commands";
import { epochNow, newUuid, type UUID } from "../primitives";
import { richTextFromPlain } from "../richtext";
import { TIMELINE_LANES, type TimelineLaneKind } from "./types";

/**
 * Timeline writes (spec §4.4.1). Two shapes matter: the event editor's CRUD, and the drag —
 * which must stay a single-row update so a drop costs one transaction, not a scene rewrite.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface CreateTimelineEventArgs {
  projectId: UUID;
  title: string;
  lane: TimelineLaneKind;
  storyTime: number;
  storyTimeEnd?: number | null;
  storyTimeLabel?: string;
  characterId?: UUID | null;
  plotlineId?: UUID | null;
  sceneId?: UUID | null;
  loreEntryId?: UUID | null;
  color?: string | null;
  description?: string;
}

function assertLane(lane: string, characterId: UUID | null, plotlineId: UUID | null): void {
  if (!TIMELINE_LANES.includes(lane as TimelineLaneKind)) {
    throw new Error(`unknown timeline lane: ${lane}`);
  }
  if (lane === "character" && characterId === null) {
    throw new Error("a character lane event needs a character");
  }
  if (lane === "plot" && plotlineId === null) {
    throw new Error("a plotline lane event needs a plotline");
  }
}

function assertTimes(storyTime: number, storyTimeEnd: number | null): void {
  if (!Number.isFinite(storyTime)) throw new Error("story time must be a number");
  if (storyTimeEnd !== null && storyTimeEnd < storyTime) {
    throw new Error("the end of an event cannot be before its start");
  }
}

function assertColor(color: string | null | undefined): string | null {
  if (color === null || color === undefined || color === "") return null;
  if (!HEX_RE.test(color)) throw new Error("event colour must be #RRGGBB");
  return color;
}

export const createTimelineEvent: Command<CreateTimelineEventArgs, { eventId: UUID }> = {
  name: "timeline.createEvent",
  async run(ctx, args) {
    const title = args.title.trim().slice(0, 120);
    if (title.length === 0) throw new Error("an event needs a title");
    const characterId = args.characterId ?? null;
    const plotlineId = args.plotlineId ?? null;
    assertLane(args.lane, characterId, plotlineId);
    const storyTimeEnd = args.storyTimeEnd ?? null;
    assertTimes(args.storyTime, storyTimeEnd);
    const description = richTextFromPlain(args.description ?? "");
    const eventId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO timeline_event
         (id, project_id, title, description_json, description_text, story_time, story_time_end,
          story_time_label, lane, character_id, plotline_id, scene_id, lore_entry_id, color,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        args.projectId,
        title,
        JSON.stringify(description.json),
        description.text,
        args.storyTime,
        storyTimeEnd,
        (args.storyTimeLabel ?? "").slice(0, 60),
        args.lane,
        characterId,
        plotlineId,
        args.sceneId ?? null,
        args.loreEntryId ?? null,
        assertColor(args.color),
        now,
        now,
      ],
    );
    return {
      result: { eventId },
      changes: [
        { table: "timeline_event", op: "insert", id: eventId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface UpdateTimelineEventArgs {
  projectId: UUID;
  eventId: UUID;
  patch: {
    title?: string;
    storyTime?: number;
    storyTimeEnd?: number | null;
    storyTimeLabel?: string;
    color?: string | null;
    sceneId?: UUID | null;
    loreEntryId?: UUID | null;
    description?: string;
  };
}

export const updateTimelineEvent: Command<UpdateTimelineEventArgs, void> = {
  name: "timeline.updateEvent",
  async run(ctx, args) {
    const rows = await ctx.tx.query<{
      story_time: number;
      story_time_end: number | null;
    }>(
      "SELECT story_time, story_time_end FROM timeline_event WHERE id = ? AND project_id = ? AND deleted_at IS NULL",
      [args.eventId, args.projectId],
    );
    const current = rows[0];
    if (!current) throw new Error("event not found");
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (args.patch.title !== undefined) {
      const title = args.patch.title.trim().slice(0, 120);
      if (title.length === 0) throw new Error("an event needs a title");
      sets.push("title = ?");
      params.push(title);
    }
    const storyTime = args.patch.storyTime ?? Number(current.story_time);
    const storyTimeEnd =
      args.patch.storyTimeEnd === undefined
        ? current.story_time_end === null
          ? null
          : Number(current.story_time_end)
        : args.patch.storyTimeEnd;
    if (args.patch.storyTime !== undefined || args.patch.storyTimeEnd !== undefined) {
      assertTimes(storyTime, storyTimeEnd);
      sets.push("story_time = ?", "story_time_end = ?");
      params.push(storyTime, storyTimeEnd);
    }
    if (args.patch.storyTimeLabel !== undefined) {
      sets.push("story_time_label = ?");
      params.push(args.patch.storyTimeLabel.slice(0, 60));
    }
    if (args.patch.color !== undefined) {
      sets.push("color = ?");
      params.push(assertColor(args.patch.color));
    }
    if (args.patch.sceneId !== undefined) {
      sets.push("scene_id = ?");
      params.push(args.patch.sceneId);
    }
    if (args.patch.loreEntryId !== undefined) {
      sets.push("lore_entry_id = ?");
      params.push(args.patch.loreEntryId);
    }
    if (args.patch.description !== undefined) {
      const description = richTextFromPlain(args.patch.description);
      sets.push("description_json = ?", "description_text = ?");
      params.push(JSON.stringify(description.json), description.text);
    }
    if (sets.length === 0) throw new Error("empty event patch");
    params.push(epochNow(), args.eventId, args.projectId);
    await ctx.tx.query(
      `UPDATE timeline_event SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    return {
      result: undefined,
      changes: [
        { table: "timeline_event", op: "update", id: args.eventId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface DeleteTimelineEventArgs {
  projectId: UUID;
  eventId: UUID;
}

export const deleteTimelineEvent: Command<DeleteTimelineEventArgs, void> = {
  name: "timeline.deleteEvent",
  async run(ctx, args) {
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE timeline_event SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.eventId, args.projectId],
    );
    return {
      result: undefined,
      changes: [
        { table: "timeline_event", op: "delete", id: args.eventId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface MoveTimelineItemArgs {
  projectId: UUID;
  kind: "scene" | "event";
  id: UUID;
  storyTime: number;
  /** Events only; ignored for scenes (they have no end time in v1). */
  storyTimeEnd?: number | null;
}

/**
 * The drag path: one row, one transaction. Scenes keep their free-text label (the formatted
 * date is derived on read), events keep their duration when they have one.
 */
export const moveTimelineItem: Command<MoveTimelineItemArgs, void> = {
  name: "timeline.moveItem",
  async run(ctx, args) {
    if (!Number.isFinite(args.storyTime)) throw new Error("story time must be a number");
    const changes: ChangeEvent[] = [];
    if (args.kind === "scene") {
      const rows = await ctx.tx.query<{ id: string }>(
        "SELECT id FROM scene WHERE id = ? AND project_id = ? AND deleted_at IS NULL",
        [args.id, args.projectId],
      );
      if (!rows[0]) throw new Error("scene not found");
      await ctx.tx.query("UPDATE scene SET story_time = ?, updated_at = ? WHERE id = ?", [
        args.storyTime,
        epochNow(),
        args.id,
      ]);
      changes.push({ table: "scene", op: "update", id: args.id, parentIds: [args.projectId] });
      return { result: undefined, changes };
    }
    const rows = await ctx.tx.query<{ story_time: number; story_time_end: number | null }>(
      "SELECT story_time, story_time_end FROM timeline_event WHERE id = ? AND project_id = ? AND deleted_at IS NULL",
      [args.id, args.projectId],
    );
    const current = rows[0];
    if (!current) throw new Error("event not found");
    const duration =
      current.story_time_end === null
        ? null
        : Number(current.story_time_end) - Number(current.story_time);
    const end =
      args.storyTimeEnd !== undefined
        ? args.storyTimeEnd
        : duration === null
          ? null
          : args.storyTime + duration;
    assertTimes(args.storyTime, end ?? null);
    await ctx.tx.query(
      "UPDATE timeline_event SET story_time = ?, story_time_end = ?, updated_at = ? WHERE id = ?",
      [args.storyTime, end, epochNow(), args.id],
    );
    changes.push({
      table: "timeline_event",
      op: "update",
      id: args.id,
      parentIds: [args.projectId],
    });
    return { result: undefined, changes };
  },
};
