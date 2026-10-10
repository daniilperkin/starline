import type { ChangeEvent } from "../changes";
import { CHARACTER_ROLE_COLORS } from "../characters/types";
import type { Command, SqlRunner } from "../commands";
import type { LoreKind } from "../entities";
import { syncMentions } from "../lore/mentions";
import { LORE_KINDS } from "../lore/types";
import { epochNow, newUuid, orderKeyBetween, type UUID } from "../primitives";
import { EMPTY_RICH_TEXT, type RichText } from "../richtext";
import { PLOTLINE_KIND_COLORS } from "../scenes/types";
import {
  NOTE_KINDS,
  NOTE_STATUSES,
  NOTE_TITLE_MAX,
  type NoteKind,
  type NoteStatus,
  PROMOTE_TARGETS,
  type PromoteTarget,
} from "./types";

/** Table behind the notes board — the only SQL identifier this module spells out twice. */
const NOTE_TABLE = "idea_note";

function assertKind(kind: string): asserts kind is NoteKind {
  if (!(NOTE_KINDS as readonly string[]).includes(kind))
    throw new Error(`unknown note kind: ${kind}`);
}

function assertStatus(status: string): asserts status is NoteStatus {
  if (!(NOTE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`unknown note status: ${status}`);
  }
}

function cleanTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length > NOTE_TITLE_MAX) {
    throw new Error(`note title must be at most ${NOTE_TITLE_MAX} characters`);
  }
  return trimmed;
}

async function lastOrderKeyInStatus(
  tx: SqlRunner,
  projectId: UUID,
  status: NoteStatus,
): Promise<string | null> {
  const rows = await tx.query<{ order_key: string }>(
    `SELECT order_key FROM ${NOTE_TABLE}
      WHERE project_id = ? AND status = ? AND deleted_at IS NULL
      ORDER BY order_key DESC LIMIT 1`,
    [projectId, status],
  );
  return rows[0]?.order_key ?? null;
}

export interface CreateNoteArgs {
  projectId: UUID;
  title: string;
  kind?: NoteKind;
  status?: NoteStatus;
  body?: RichText;
  sourceUrl?: string;
}

/**
 * One thought in the incubator (spec §4.4.2). Quick capture hits this with nothing but a title;
 * the note lands in the Inbox and can be sorted into a column later.
 */
export const createNote: Command<CreateNoteArgs, { noteId: UUID }> = {
  name: "note.create",
  async run(ctx, args) {
    const title = cleanTitle(args.title);
    const kind = args.kind ?? "idea";
    assertKind(kind);
    const status = args.status ?? "inbox";
    assertStatus(status);
    const body = args.body ?? EMPTY_RICH_TEXT;
    const orderKey = orderKeyBetween(
      await lastOrderKeyInStatus(ctx.tx, args.projectId, status),
      null,
    );
    const noteId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO ${NOTE_TABLE}
         (id, project_id, title, kind, status, body_json, body_text, source_url, pinned, color,
          order_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
      [
        noteId,
        args.projectId,
        title,
        kind,
        status,
        body.json === null ? null : JSON.stringify(body.json),
        body.text,
        args.sourceUrl?.trim() ?? "",
        orderKey,
        now,
        now,
      ],
    );
    await syncMentions(ctx.tx, "note", noteId, "body", body.json);
    return {
      result: { noteId },
      changes: [{ table: NOTE_TABLE, op: "insert", id: noteId, parentIds: [args.projectId] }],
    };
  },
};

export interface UpdateNotePatch {
  title?: string;
  kind?: NoteKind;
  status?: NoteStatus;
  body?: RichText;
  sourceUrl?: string;
  pinned?: boolean;
  color?: string | null;
  /** The promote link itself — settable so undo can put the note back exactly as it was. */
  promoted?: { type: PromoteTarget; id: UUID } | null;
}

export interface UpdateNoteArgs {
  projectId: UUID;
  noteId: UUID;
  patch: UpdateNotePatch;
}

/** Whitelisted patch of one note. Body edits re-sync mentions immediately (spec §3.6). */
export const updateNote: Command<UpdateNoteArgs, { updated: boolean }> = {
  name: "note.update",
  async run(ctx, args) {
    const found = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM ${NOTE_TABLE} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.noteId, args.projectId],
    );
    if (found.length === 0) return { result: { updated: false }, changes: [] };

    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const patch = args.patch;
    if (patch.title !== undefined) {
      sets.push("title = ?");
      params.push(cleanTitle(patch.title));
    }
    if (patch.kind !== undefined) {
      assertKind(patch.kind);
      sets.push("kind = ?");
      params.push(patch.kind);
    }
    if (patch.status !== undefined) {
      assertStatus(patch.status);
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (patch.body !== undefined) {
      sets.push("body_json = ?", "body_text = ?");
      params.push(
        patch.body.json === null ? null : JSON.stringify(patch.body.json),
        patch.body.text,
      );
    }
    if (patch.sourceUrl !== undefined) {
      sets.push("source_url = ?");
      params.push(patch.sourceUrl.trim());
    }
    if (patch.pinned !== undefined) {
      sets.push("pinned = ?");
      params.push(patch.pinned ? 1 : 0);
    }
    if (patch.color !== undefined) {
      sets.push("color = ?");
      params.push(patch.color);
    }
    if (patch.promoted !== undefined) {
      if (
        patch.promoted !== null &&
        !(PROMOTE_TARGETS as readonly string[]).includes(patch.promoted.type)
      ) {
        throw new Error(`unknown promote target: ${patch.promoted.type}`);
      }
      sets.push("promoted_to_type = ?", "promoted_to_id = ?");
      params.push(patch.promoted?.type ?? null, patch.promoted?.id ?? null);
    }
    if (sets.length === 0) return { result: { updated: false }, changes: [] };

    sets.push("updated_at = ?");
    params.push(epochNow());
    await ctx.tx.query(
      `UPDATE ${NOTE_TABLE} SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`,
      [...params, args.noteId, args.projectId],
    );
    if (patch.body !== undefined) {
      await syncMentions(ctx.tx, "note", args.noteId, "body", patch.body.json);
    }
    return {
      result: { updated: true },
      changes: [{ table: NOTE_TABLE, op: "update", id: args.noteId, parentIds: [args.projectId] }],
    };
  },
};

export interface MoveNoteArgs {
  projectId: UUID;
  noteId: UUID;
  status: NoteStatus;
  /** Drop it in front of this note; null appends to the end of the column. */
  beforeNoteId?: UUID | null;
}

/** Board drag/swipe: status + position in one write (spec §4.4.2). */
export const moveNote: Command<MoveNoteArgs, { moved: boolean }> = {
  name: "note.move",
  async run(ctx, args) {
    assertStatus(args.status);
    const current = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM ${NOTE_TABLE} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.noteId, args.projectId],
    );
    if (current.length === 0) return { result: { moved: false }, changes: [] };

    let beforeKey: string | null = null;
    if (args.beforeNoteId) {
      const rows = await ctx.tx.query<{ order_key: string }>(
        `SELECT order_key FROM ${NOTE_TABLE}
          WHERE id = ? AND project_id = ? AND status = ? AND deleted_at IS NULL`,
        [args.beforeNoteId, args.projectId, args.status],
      );
      beforeKey = rows[0]?.order_key ?? null;
    }
    let prevKey: string | null = null;
    if (beforeKey !== null) {
      const rows = await ctx.tx.query<{ order_key: string }>(
        `SELECT order_key FROM ${NOTE_TABLE}
          WHERE project_id = ? AND status = ? AND deleted_at IS NULL AND order_key < ?
          ORDER BY order_key DESC LIMIT 1`,
        [args.projectId, args.status, beforeKey],
      );
      prevKey = rows[0]?.order_key ?? null;
    } else {
      prevKey = await lastOrderKeyInStatus(ctx.tx, args.projectId, args.status);
    }
    await ctx.tx.query(
      `UPDATE ${NOTE_TABLE} SET status = ?, order_key = ?, updated_at = ?
        WHERE id = ? AND project_id = ?`,
      [args.status, orderKeyBetween(prevKey, beforeKey), epochNow(), args.noteId, args.projectId],
    );
    return {
      result: { moved: true },
      changes: [{ table: NOTE_TABLE, op: "update", id: args.noteId, parentIds: [args.projectId] }],
    };
  },
};

export interface DeleteNoteArgs {
  projectId: UUID;
  noteId: UUID;
}

/** Soft delete — the Trash restores it like any other entity (spec §3.9). */
export const deleteNote: Command<DeleteNoteArgs, { deleted: boolean }> = {
  name: "note.delete",
  async run(ctx, args) {
    const found = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM ${NOTE_TABLE} WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.noteId, args.projectId],
    );
    if (found.length === 0) return { result: { deleted: false }, changes: [] };
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE ${NOTE_TABLE} SET deleted_at = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
      [now, now, args.noteId, args.projectId],
    );
    return {
      result: { deleted: true },
      changes: [{ table: NOTE_TABLE, op: "delete", id: args.noteId, parentIds: [args.projectId] }],
    };
  },
};

export interface PromoteNoteArgs {
  projectId: UUID;
  noteId: UUID;
  target: PromoteTarget;
  /** Required when target = "lore" (spec §4.4.2's kind picker); ignored otherwise. */
  loreKind?: LoreKind;
}

export interface PromoteNoteResult {
  entityId: UUID;
  /** The status the note had before — the undo inverse moves it back here. */
  previousStatus: NoteStatus;
}

/**
 * Promote a note into a real entity, in one transaction (spec §4.4.2): the row is created, the
 * note records where it went, and the note moves to "used". The body travels with it — a promoted
 * scene starts with the note's text as its synopsis, a character keeps it as a storyline seed.
 */
export const promoteNote: Command<PromoteNoteArgs, PromoteNoteResult> = {
  name: "note.promote",
  async run(ctx, args) {
    if (!(PROMOTE_TARGETS as readonly string[]).includes(args.target)) {
      throw new Error(`unknown promote target: ${args.target}`);
    }
    const rows = await ctx.tx.query<{
      title: string;
      status: string;
      body_json: string | null;
      body_text: string;
    }>(
      `SELECT title, status, body_json, body_text FROM ${NOTE_TABLE}
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.noteId, args.projectId],
    );
    const note = rows[0];
    if (!note) throw new Error("note not found");
    const previousStatus = note.status as NoteStatus;
    const now = epochNow();
    const entityId = newUuid();
    const changes: ChangeEvent[] = [];

    if (args.target === "scene") {
      const last = await ctx.tx.query<{ order_key: string }>(
        `SELECT order_key FROM scene
          WHERE project_id = ? AND chapter_id IS NULL AND deleted_at IS NULL
          ORDER BY order_key DESC LIMIT 1`,
        [args.projectId],
      );
      await ctx.tx.query(
        `INSERT INTO scene (id, project_id, chapter_id, order_key, title, synopsis_json, synopsis_text,
                            pov_character_id, target_word_count, snowflake_source, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        [
          entityId,
          args.projectId,
          orderKeyBetween(last[0]?.order_key ?? null, null),
          note.title.trim(),
          note.body_json,
          note.body_text,
          now,
          now,
        ],
      );
      changes.push({ table: "scene", op: "insert", id: entityId, parentIds: [args.projectId] });
    } else if (args.target === "character") {
      const last = await ctx.tx.query<{ order_key: string }>(
        `SELECT order_key FROM character WHERE project_id = ? AND deleted_at IS NULL
          ORDER BY order_key DESC LIMIT 1`,
        [args.projectId],
      );
      await ctx.tx.query(
        `INSERT INTO character (id, project_id, name, role, color, storyline_json, storyline_text,
                                order_key, created_at, updated_at)
         VALUES (?, ?, ?, 'supporting', ?, ?, ?, ?, ?, ?)`,
        [
          entityId,
          args.projectId,
          note.title.trim() || "Unnamed character",
          CHARACTER_ROLE_COLORS.supporting,
          note.body_json,
          note.body_text,
          orderKeyBetween(last[0]?.order_key ?? null, null),
          now,
          now,
        ],
      );
      changes.push({ table: "character", op: "insert", id: entityId, parentIds: [args.projectId] });
    } else if (args.target === "lore") {
      const kind: LoreKind = args.loreKind ?? "location";
      if (!LORE_KINDS.includes(kind)) throw new Error(`unknown lore kind: ${kind}`);
      const last = await ctx.tx.query<{ order_key: string }>(
        `SELECT order_key FROM lore_entry WHERE project_id = ? AND deleted_at IS NULL
          ORDER BY order_key DESC LIMIT 1`,
        [args.projectId],
      );
      await ctx.tx.query(
        `INSERT INTO lore_entry
           (id, project_id, category_id, parent_entry_id, kind, custom_kind_label, name, aliases,
            summary, body_json, body_text, order_key, pinned, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, ?, '', ?, '[]', '', ?, ?, ?, 0, ?, ?)`,
        [
          entityId,
          args.projectId,
          kind,
          note.title.trim() || "Untitled",
          note.body_json,
          note.body_text,
          orderKeyBetween(last[0]?.order_key ?? null, null),
          now,
          now,
        ],
      );
      changes.push({
        table: "lore_entry",
        op: "insert",
        id: entityId,
        parentIds: [args.projectId],
      });
    } else {
      const last = await ctx.tx.query<{ order_key: string }>(
        `SELECT order_key FROM plotline WHERE project_id = ? AND deleted_at IS NULL
          ORDER BY order_key DESC LIMIT 1`,
        [args.projectId],
      );
      await ctx.tx.query(
        `INSERT INTO plotline (id, project_id, name, description_json, description_text, color,
                               order_key, kind, character_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'subplot', NULL, ?, ?)`,
        [
          entityId,
          args.projectId,
          note.title.trim() || "Untitled plotline",
          note.body_json,
          note.body_text,
          PLOTLINE_KIND_COLORS.subplot,
          orderKeyBetween(last[0]?.order_key ?? null, null),
          now,
          now,
        ],
      );
      changes.push({ table: "plotline", op: "insert", id: entityId, parentIds: [args.projectId] });
    }

    await ctx.tx.query(
      `UPDATE ${NOTE_TABLE}
          SET promoted_to_type = ?, promoted_to_id = ?, status = 'used', updated_at = ?
        WHERE id = ? AND project_id = ?`,
      [args.target, entityId, now, args.noteId, args.projectId],
    );
    changes.push({ table: NOTE_TABLE, op: "update", id: args.noteId, parentIds: [args.projectId] });

    return { result: { entityId, previousStatus }, changes };
  },
};
