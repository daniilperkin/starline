import type { ChangeEvent } from "../changes";
import type { Command, SqlRunner } from "../commands";
import type { RelationshipKind } from "../entities";
import { epochNow, newUuid, orderKeyBetween, type UUID } from "../primitives";
import {
  clampSentiment,
  defaultDirected,
  type GraphPositions,
  normalizeEdgePair,
  RELATIONSHIP_KINDS,
  type RelationshipDraft,
  type RelationshipPatch,
} from "./types";

const META_GRAPH_POSITIONS = "graph_positions";

/** Trimmed custom label rules: required for `custom`, forbidden otherwise (schema CHECK §3.5). */
function resolveCustomLabel(kind: RelationshipKind, label: string | undefined): string {
  const trimmed = (label ?? "").trim();
  if (kind === "custom") {
    if (trimmed.length === 0) throw new Error("a custom relationship needs a label");
    if (trimmed.length > 60) throw new Error("custom relationship labels are 1–60 characters");
    return trimmed;
  }
  if (trimmed.length > 0) throw new Error(`relationship kind ${kind} cannot carry a custom label`);
  return "";
}

function assertKnownKind(kind: string): asserts kind is RelationshipKind {
  if (!RELATIONSHIP_KINDS.includes(kind as RelationshipKind)) {
    throw new Error(`unknown relationship kind: ${kind}`);
  }
}

/** Both ends must be live characters of this project (the FK alone would accept a trashed one). */
async function assertCharactersLive(
  tx: SqlRunner,
  projectId: UUID,
  ids: readonly UUID[],
): Promise<void> {
  const rows = await tx.query<{ id: string }>(
    `SELECT id FROM character WHERE project_id = ? AND deleted_at IS NULL AND id IN (${ids
      .map(() => "?")
      .join(", ")})`,
    [projectId, ...ids],
  );
  const found = new Set(rows.map((row) => row.id));
  for (const id of ids) {
    if (!found.has(id)) throw new Error("relationship end is not a character of this project");
  }
}

/** The unique index keys on (source, target, kind, custom_label) for live rows (spec §3.5). */
async function findEdge(
  tx: SqlRunner,
  pair: { sourceId: UUID; targetId: UUID },
  kind: RelationshipKind,
  customLabel: string,
): Promise<{ id: string; deleted_at: number | null } | null> {
  const rows = await tx.query<{ id: string; deleted_at: number | null }>(
    `SELECT id, deleted_at FROM character_relationship
      WHERE source_id = ? AND target_id = ? AND kind = ? AND custom_label = ?
      ORDER BY deleted_at IS NULL DESC LIMIT 1`,
    [pair.sourceId, pair.targetId, kind, customLabel],
  );
  return rows[0] ?? null;
}

export interface CreateRelationshipArgs extends RelationshipDraft {
  projectId: UUID;
}

/**
 * One edge per (pair, kind, label). A soft-deleted edge of the same shape is revived instead of
 * duplicated, so undo/redo of a delete keeps the row identity the UI already knows.
 */
export const createRelationship: Command<CreateRelationshipArgs, { relationshipId: UUID }> = {
  name: "relationship.create",
  async run(ctx, args) {
    assertKnownKind(args.kind);
    if (args.sourceId === args.targetId) throw new Error("a relationship needs two characters");
    const customLabel = resolveCustomLabel(args.kind, args.customLabel);
    const directed = args.directed ?? defaultDirected(args.kind);
    const sentiment = clampSentiment(args.sentiment ?? 0);
    const pair = normalizeEdgePair(args.sourceId, args.targetId, directed);
    await assertCharactersLive(ctx.tx, args.projectId, [pair.sourceId, pair.targetId]);

    const existing = await findEdge(ctx.tx, pair, args.kind, customLabel);
    const now = epochNow();
    const notesJson = args.notes === undefined ? null : JSON.stringify(args.notes.json);
    const notesText = args.notes?.text ?? "";
    if (existing && existing.deleted_at === null) {
      throw new Error("this relationship already exists");
    }
    let relationshipId: UUID;
    if (existing) {
      relationshipId = existing.id as UUID;
      await ctx.tx.query(
        `UPDATE character_relationship
            SET directed = ?, sentiment = ?, notes_json = ?, notes_text = ?, group_id = ?,
                starts_at_scene_id = ?, ends_at_scene_id = ?, secret = ?, deleted_at = NULL,
                updated_at = ?
          WHERE id = ?`,
        [
          directed ? 1 : 0,
          sentiment,
          notesJson,
          notesText,
          args.groupId ?? null,
          args.startsAtSceneId ?? null,
          args.endsAtSceneId ?? null,
          args.secret ? 1 : 0,
          now,
          relationshipId,
        ],
      );
    } else {
      relationshipId = newUuid();
      await ctx.tx.query(
        `INSERT INTO character_relationship
           (id, project_id, source_id, target_id, kind, custom_label, directed, sentiment,
            notes_json, notes_text, group_id, starts_at_scene_id, ends_at_scene_id, secret,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          relationshipId,
          args.projectId,
          pair.sourceId,
          pair.targetId,
          args.kind,
          customLabel,
          directed ? 1 : 0,
          sentiment,
          notesJson,
          notesText,
          args.groupId ?? null,
          args.startsAtSceneId ?? null,
          args.endsAtSceneId ?? null,
          args.secret ? 1 : 0,
          now,
          now,
        ],
      );
    }
    return {
      result: { relationshipId },
      changes: [
        {
          table: "character_relationship",
          op: existing ? "update" : "insert",
          id: relationshipId,
          parentIds: [args.projectId],
        },
      ],
    };
  },
};

export interface UpdateRelationshipArgs {
  projectId: UUID;
  relationshipId: UUID;
  patch: RelationshipPatch;
}

const PATCH_COLUMNS: Record<keyof RelationshipPatch, string> = {
  kind: "kind",
  customLabel: "custom_label",
  directed: "directed",
  sentiment: "sentiment",
  notes: "notes_text",
  groupId: "group_id",
  startsAtSceneId: "starts_at_scene_id",
  endsAtSceneId: "ends_at_scene_id",
  secret: "secret",
};

export const updateRelationship: Command<UpdateRelationshipArgs, void> = {
  name: "relationship.update",
  async run(ctx, args) {
    const rows = await ctx.tx.query<{
      source_id: string;
      target_id: string;
      kind: string;
      custom_label: string;
      directed: number;
    }>(
      `SELECT source_id, target_id, kind, custom_label, directed FROM character_relationship
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [args.relationshipId, args.projectId],
    );
    const current = rows[0];
    if (!current) throw new Error("relationship not found");
    if (Object.keys(args.patch).length === 0) throw new Error("empty relationship patch");

    const kind = args.patch.kind ?? (current.kind as RelationshipKind);
    assertKnownKind(kind);
    const customLabel = resolveCustomLabel(
      kind,
      args.patch.customLabel ?? (kind === current.kind ? current.custom_label : undefined),
    );
    const directed = args.patch.directed ?? current.directed === 1;
    const pair = normalizeEdgePair(current.source_id as UUID, current.target_id as UUID, directed);

    // Re-keying (kind/label/direction) can collide with another live edge — refuse with words
    // the UI can show instead of leaking a UNIQUE constraint error.
    if (
      kind !== current.kind ||
      customLabel !== current.custom_label ||
      directed !== (current.directed === 1)
    ) {
      const clash = await findEdge(ctx.tx, pair, kind, customLabel);
      if (clash && clash.deleted_at === null && clash.id !== args.relationshipId) {
        throw new Error("this relationship already exists");
      }
    }

    const { notes, kind: patchKind, customLabel: patchLabel, ...plain } = args.patch;
    const sets: string[] = ["source_id = ?", "target_id = ?"];
    const params: Array<string | number | null> = [pair.sourceId, pair.targetId];
    // `kind` and `custom_label` are one unit: the schema CHECK ties them together
    // ((kind = 'custom') = (length(custom_label) > 0)), so changing either writes both — a
    // kind-only patch that left a stale label would trip the constraint.
    if (patchKind !== undefined || patchLabel !== undefined) {
      sets.push("kind = ?", "custom_label = ?");
      params.push(kind, customLabel);
    }
    for (const [key, value] of Object.entries(plain) as Array<
      [keyof typeof plain, RelationshipPatch[keyof RelationshipPatch]]
    >) {
      if (value === undefined) continue;
      if (key === "directed") {
        sets.push("directed = ?");
        params.push(value ? 1 : 0);
      } else if (key === "sentiment") {
        sets.push("sentiment = ?");
        params.push(clampSentiment(value as number));
      } else if (key === "secret") {
        sets.push("secret = ?");
        params.push(value ? 1 : 0);
      } else {
        sets.push(`${PATCH_COLUMNS[key]} = ?`);
        params.push(value as string | null);
      }
    }
    if (notes !== undefined) {
      sets.push("notes_json = ?", "notes_text = ?");
      params.push(notes.json === null ? null : JSON.stringify(notes.json), notes.text);
    }
    params.push(epochNow(), args.relationshipId, args.projectId);
    await ctx.tx.query(
      `UPDATE character_relationship SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    return {
      result: undefined,
      changes: [
        {
          table: "character_relationship",
          op: "update",
          id: args.relationshipId,
          parentIds: [args.projectId],
        },
      ],
    };
  },
};

export interface DeleteRelationshipArgs {
  projectId: UUID;
  relationshipId: UUID;
}

export const deleteRelationship: Command<DeleteRelationshipArgs, void> = {
  name: "relationship.delete",
  async run(ctx, args) {
    const now = epochNow();
    await ctx.tx.query(
      `UPDATE character_relationship SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.relationshipId, args.projectId],
    );
    return {
      result: undefined,
      changes: [
        {
          table: "character_relationship",
          op: "delete",
          id: args.relationshipId,
          parentIds: [args.projectId],
        },
      ],
    };
  },
};

export interface CreateRelationshipGroupArgs {
  projectId: UUID;
  name: string;
  color: string;
}

export const createRelationshipGroup: Command<CreateRelationshipGroupArgs, { groupId: UUID }> = {
  name: "relationshipGroup.create",
  async run(ctx, args) {
    const name = args.name.trim();
    if (name.length === 0 || name.length > 60)
      throw new Error("group name must be 1–60 characters");
    if (!/^#[0-9a-fA-F]{6}$/.test(args.color)) throw new Error(`invalid colour: ${args.color}`);
    const last = await ctx.tx.query<{ order_key: string }>(
      `SELECT order_key FROM relationship_group
        WHERE project_id = ? AND deleted_at IS NULL ORDER BY order_key DESC LIMIT 1`,
      [args.projectId],
    );
    const groupId = newUuid();
    const now = epochNow();
    await ctx.tx.query(
      `INSERT INTO relationship_group (id, project_id, name, color, order_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        groupId,
        args.projectId,
        name,
        args.color,
        orderKeyBetween(last[0]?.order_key ?? null, null),
        now,
        now,
      ],
    );
    return {
      result: { groupId },
      changes: [
        { table: "relationship_group", op: "insert", id: groupId, parentIds: [args.projectId] },
      ],
    };
  },
};

export interface UpdateRelationshipGroupArgs {
  projectId: UUID;
  groupId: UUID;
  patch: { name?: string; color?: string };
}

export const updateRelationshipGroup: Command<UpdateRelationshipGroupArgs, void> = {
  name: "relationshipGroup.update",
  async run(ctx, args) {
    const sets: string[] = [];
    const params: Array<string | number> = [];
    if (args.patch.name !== undefined) {
      const name = args.patch.name.trim();
      if (name.length === 0 || name.length > 60)
        throw new Error("group name must be 1–60 characters");
      sets.push("name = ?");
      params.push(name);
    }
    if (args.patch.color !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(args.patch.color))
        throw new Error(`invalid colour: ${args.patch.color}`);
      sets.push("color = ?");
      params.push(args.patch.color);
    }
    if (sets.length === 0) throw new Error("empty group patch");
    params.push(epochNow(), args.groupId, args.projectId);
    await ctx.tx.query(
      `UPDATE relationship_group SET ${sets.join(", ")}, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      params,
    );
    return {
      result: undefined,
      changes: [
        {
          table: "relationship_group",
          op: "update",
          id: args.groupId,
          parentIds: [args.projectId],
        },
      ],
    };
  },
};

export interface DeleteRelationshipGroupArgs {
  projectId: UUID;
  groupId: UUID;
}

/**
 * Soft-deleting the group cannot rely on the FK's ON DELETE SET NULL (that fires on a hard
 * DELETE), so members are detached explicitly — same shape as the lore category cascade.
 */
export const deleteRelationshipGroup: Command<DeleteRelationshipGroupArgs, { detached: number }> = {
  name: "relationshipGroup.delete",
  async run(ctx, args) {
    const now = epochNow();
    const members = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM character_relationship WHERE group_id = ? AND deleted_at IS NULL`,
      [args.groupId],
    );
    await ctx.tx.query(
      `UPDATE character_relationship SET group_id = NULL, updated_at = ? WHERE group_id = ?`,
      [now, args.groupId],
    );
    await ctx.tx.query(
      `UPDATE relationship_group SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND deleted_at IS NULL`,
      [now, now, args.groupId, args.projectId],
    );
    return {
      result: { detached: members.length },
      changes: [
        {
          table: "relationship_group",
          op: "delete",
          id: args.groupId,
          parentIds: [args.projectId],
        },
        ...members.map(
          (member): ChangeEvent => ({
            table: "character_relationship",
            op: "update",
            id: member.id,
            parentIds: [args.projectId],
          }),
        ),
      ],
    };
  },
};

export interface SetGraphPositionsArgs {
  projectId: UUID;
  positions: GraphPositions;
}

/**
 * Manual node pins live in the `graph_positions` meta key (spec §4.2.3 — "not a separate
 * table"), nested per project so one file holding two books keeps two layouts.
 */
export const setGraphPositions: Command<SetGraphPositionsArgs, void> = {
  name: "relationship.setGraphPositions",
  async run(ctx, args) {
    const rows = await ctx.tx.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
      META_GRAPH_POSITIONS,
    ]);
    let all: Record<string, GraphPositions> = {};
    try {
      all = rows[0] ? (JSON.parse(rows[0].value) as Record<string, GraphPositions>) : {};
    } catch {
      all = {}; // a hand-edited file must not brick the graph
    }
    all[args.projectId] = args.positions;
    const value = JSON.stringify(all);
    await ctx.tx.query(
      `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [META_GRAPH_POSITIONS, value],
    );
    return {
      result: undefined,
      changes: [
        { table: "meta", op: "update", id: META_GRAPH_POSITIONS, parentIds: [args.projectId] },
      ],
    };
  },
};
