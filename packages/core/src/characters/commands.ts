import type { ChangeEvent } from "../changes";
import type { Command } from "../commands";
import type { ArcType, CharacterRole } from "../entities";
import { epochNow, newUuid, orderKeyBetween, type UUID } from "../primitives";
import { CHARACTER_ROLE_COLORS, CHARACTER_ROLES, type CharacterDraft } from "./types";

export interface CreateCharacterArgs {
  projectId: UUID;
  name: string;
  role?: CharacterRole;
  color?: string;
}

/** Adding a card creates the Character row immediately (spec §4.2 point 5). */
export const createCharacter: Command<CreateCharacterArgs, { characterId: UUID }> = {
  name: "character.create",
  async run(ctx, args) {
    const name = args.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new Error("character name must be 1–120 characters");
    }
    const role = args.role ?? "supporting";
    if (!CHARACTER_ROLES.includes(role)) throw new Error(`unknown role: ${role}`);
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM character
        WHERE project_id = ? AND deleted_at IS NULL
        ORDER BY order_key DESC LIMIT 1`,
      [args.projectId],
    );
    const orderKey = orderKeyBetween(last[0]?.order_key ?? null, null);
    const characterId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO character (id, project_id, name, role, color, order_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        characterId,
        args.projectId,
        name,
        role,
        args.color ?? CHARACTER_ROLE_COLORS[role],
        orderKey,
        now,
        now,
      ],
    );
    const changes: ChangeEvent[] = [
      { table: "character", op: "insert", id: characterId, parentIds: [args.projectId] },
    ];
    return { result: { characterId }, changes };
  },
};

/** Whitelisted column map for `updateCharacter` — the only fields v1 forms may write. */
const UPDATABLE_COLUMNS: Record<keyof CharacterDraft, string> = {
  name: "name",
  role: "role",
  color: "color",
  arcType: "arc_type",
  oneLine: "one_line",
  oneParagraphText: "one_paragraph_text",
  motivation: "motivation",
  goal: "goal",
  conflict: "conflict",
  epiphany: "epiphany",
};

export type CharacterPatch = Partial<CharacterDraft>;

export interface UpdateCharacterArgs {
  projectId: UUID;
  characterId: UUID;
  patch: CharacterPatch;
}

export const updateCharacter: Command<UpdateCharacterArgs, void> = {
  name: "character.update",
  async run(ctx, args) {
    const entries = Object.entries(args.patch) as Array<[keyof CharacterDraft, string]>;
    if (entries.length === 0) throw new Error("empty character patch");
    if (args.patch.name !== undefined) {
      const name = args.patch.name.trim();
      if (name.length === 0 || name.length > 120) {
        throw new Error("character name must be 1–120 characters");
      }
      entries[entries.findIndex(([key]) => key === "name")] = ["name", name];
    }
    if (args.patch.role !== undefined && !CHARACTER_ROLES.includes(args.patch.role)) {
      throw new Error(`unknown role: ${args.patch.role}`);
    }
    if (args.patch.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(args.patch.color)) {
      throw new Error(`invalid colour: ${args.patch.color}`);
    }
    const sets = entries.map(([key]) => `${UPDATABLE_COLUMNS[key]} = ?`);
    const params: Array<string | number> = entries.map(([, value]) => value);
    params.push(epochNow(), args.characterId, args.projectId);
    await ctx.tx.query(
      `UPDATE character SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    return {
      result: undefined,
      changes: [
        { table: "character", op: "update", id: args.characterId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface DeleteCharacterArgs {
  projectId: UUID;
  characterId: UUID;
}

/** Soft delete (spec §5.3 trash semantics; purge lands with the trash screen). */
export const deleteCharacter: Command<DeleteCharacterArgs, void> = {
  name: "character.delete",
  async run(ctx, args) {
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE character SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.characterId, args.projectId],
    );
    return {
      result: undefined,
      changes: [
        { table: "character", op: "delete", id: args.characterId, parentIds: [args.projectId] },
      ],
    };
  },
};

/** Re-export for the UI's role pickers. */
export type { ArcType, CharacterRole };
