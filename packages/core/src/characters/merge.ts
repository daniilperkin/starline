import type { ChangeEvent } from "../changes";
import type { Command } from "../commands";
import { epochNow, type UUID } from "../primitives";

export interface MergeCharactersArgs {
  projectId: UUID;
  /** The duplicate that disappears: soft-deleted, everything it owned repoints to the target. */
  sourceId: UUID;
  /** The character that survives. */
  targetId: UUID;
}

/**
 * Every row the merge repointed, recorded with the keys needed to put it back. The inverse
 * (`unmergeCharacters`) replays these; rows DROPPED as duplicates are not recoverable — their
 * meaning already lives on the target (the spec's "combines relationships, scenes, mentions").
 */
export interface MergeMove {
  table: string;
  /** The row's primary key, JSON-encoded when composite (WITHOUT ROWID joins). */
  key: string;
}

export interface MergeCharactersResult {
  sourceId: UUID;
  targetId: UUID;
  moved: MergeMove[];
  relationshipsMoved: number;
  relationshipsDropped: number;
  scenesMoved: number;
  scenesDropped: number;
  mentionsMoved: number;
  mentionsMerged: number;
  galleryMoved: number;
  galleryDropped: number;
  fieldsMoved: number;
  fieldsDropped: number;
  timelineMoved: number;
  povMoved: number;
  plotlinesMoved: number;
  aliasesAdded: number;
}

interface CountRow {
  n: number;
}

/**
 * Merge two characters (spec §4.2's "Merge duplicates: select 2 → Merge into…"). One transaction
 * repoints every reference — relationships, scene presence, mentions, gallery, custom fields,
 * timeline events, scene POV, plotline ownership — appends the source's name and aliases to the
 * target, then soft-deletes the source. The caller snapshots before the merge (spec §4.5.3), and
 * the returned `moved` list makes the app-level Undo a real inverse command rather than a lie.
 */
export const mergeCharacters: Command<MergeCharactersArgs, MergeCharactersResult> = {
  name: "character.merge",
  async run(ctx, args) {
    if (args.sourceId === args.targetId) throw new Error("cannot merge a character into itself");
    const now = epochNow();
    const rows = await ctx.tx.query<{ id: string; name: string; aliases: string }>(
      "SELECT id, name, aliases FROM character WHERE project_id = ? AND id IN (?, ?)",
      [args.projectId, args.sourceId, args.targetId],
    );
    const source = rows.find((row) => row.id === args.sourceId);
    const target = rows.find((row) => row.id === args.targetId);
    if (!source) throw new Error("the source character does not exist in this project");
    if (!target) throw new Error("the target character does not exist in this project");

    const moved: MergeMove[] = [];
    const counts = {
      relationshipsMoved: 0,
      relationshipsDropped: 0,
      scenesMoved: 0,
      scenesDropped: 0,
      mentionsMoved: 0,
      mentionsMerged: 0,
      galleryMoved: 0,
      galleryDropped: 0,
      fieldsMoved: 0,
      fieldsDropped: 0,
      timelineMoved: 0,
      povMoved: 0,
      plotlinesMoved: 0,
      aliasesAdded: 0,
    };

    // Aliases: the source's name and aliases become the target's, so prose that says the old
    // name keeps resolving to the merged character.
    const sourceAliases = parseAliases(source.aliases);
    const targetAliases = parseAliases(target.aliases);
    const additions = [source.name, ...sourceAliases].filter(
      (value) => value.length > 0 && value !== target.name && !targetAliases.includes(value),
    );
    if (additions.length > 0) {
      counts.aliasesAdded = additions.length;
      await ctx.tx.query("UPDATE character SET aliases = ?, updated_at = ? WHERE id = ?", [
        JSON.stringify([...targetAliases, ...additions]),
        now,
        args.targetId,
      ]);
    }

    // Relationships: repoint both ends. A relationship that becomes self-referential (source↔target
    // was the edge between the two) is dropped — it described the merge itself. A duplicate edge
    // (same pair, same kind, same label, still live) is dropped in favour of the survivor.
    const rels = await ctx.tx.query<{ id: string; source_id: string; target_id: string }>(
      `SELECT id, source_id, target_id FROM character_relationship
        WHERE project_id = ? AND deleted_at IS NULL AND (source_id = ? OR target_id = ?)`,
      [args.projectId, args.sourceId, args.sourceId],
    );
    for (const rel of rels) {
      const nextSource = rel.source_id === args.sourceId ? args.targetId : rel.source_id;
      const nextTarget = rel.target_id === args.sourceId ? args.targetId : rel.target_id;
      if (nextSource === nextTarget) {
        await ctx.tx.query(
          "UPDATE character_relationship SET deleted_at = ?, updated_at = ? WHERE id = ?",
          [now, now, rel.id],
        );
        counts.relationshipsDropped += 1;
        continue;
      }
      const clash = await ctx.tx.query<CountRow>(
        `SELECT COUNT(*) AS n FROM character_relationship
          WHERE source_id = ? AND target_id = ? AND kind = (SELECT kind FROM character_relationship WHERE id = ?)
            AND custom_label = (SELECT custom_label FROM character_relationship WHERE id = ?)
            AND deleted_at IS NULL AND id <> ?`,
        [nextSource, nextTarget, rel.id, rel.id, rel.id],
      );
      if ((clash[0]?.n ?? 0) > 0) {
        await ctx.tx.query(
          "UPDATE character_relationship SET deleted_at = ?, updated_at = ? WHERE id = ?",
          [now, now, rel.id],
        );
        counts.relationshipsDropped += 1;
        continue;
      }
      await ctx.tx.query(
        "UPDATE character_relationship SET source_id = ?, target_id = ?, updated_at = ? WHERE id = ?",
        [nextSource, nextTarget, now, rel.id],
      );
      moved.push({ table: "character_relationship", key: rel.id });
      counts.relationshipsMoved += 1;
    }

    // Scene presence: the join's key includes the character, so an existing (scene, target) row
    // makes the source's row a duplicate.
    const presence = await ctx.tx.query<{ scene_id: string }>(
      "SELECT scene_id FROM scene_character WHERE character_id = ?",
      [args.sourceId],
    );
    for (const row of presence) {
      const clash = await ctx.tx.query<CountRow>(
        "SELECT COUNT(*) AS n FROM scene_character WHERE scene_id = ? AND character_id = ?",
        [row.scene_id, args.targetId],
      );
      if ((clash[0]?.n ?? 0) > 0) {
        await ctx.tx.query("DELETE FROM scene_character WHERE scene_id = ? AND character_id = ?", [
          row.scene_id,
          args.sourceId,
        ]);
        counts.scenesDropped += 1;
        continue;
      }
      await ctx.tx.query(
        "UPDATE scene_character SET character_id = ? WHERE scene_id = ? AND character_id = ?",
        [args.targetId, row.scene_id, args.sourceId],
      );
      moved.push({ table: "scene_character", key: JSON.stringify([row.scene_id, args.sourceId]) });
      counts.scenesMoved += 1;
    }

    // Mentions: the mirror rows prose created. A hit on both characters in the same source/field
    // folds into one row whose count is the sum — that is the "rewrites mention nodes" the spec asks for.
    const mentions = await ctx.tx.query<{
      source_type: string;
      source_id: string;
      field: string;
      count: number;
    }>(
      "SELECT source_type, source_id, field, count FROM mention WHERE target_type = 'character' AND target_id = ?",
      [args.sourceId],
    );
    for (const mention of mentions) {
      const clash = await ctx.tx.query<{ count: number }>(
        `SELECT count FROM mention
          WHERE source_type = ? AND source_id = ? AND field = ? AND target_type = 'character' AND target_id = ?`,
        [mention.source_type, mention.source_id, mention.field, args.targetId],
      );
      if (clash.length > 0) {
        await ctx.tx.query(
          `UPDATE mention SET count = ?
            WHERE source_type = ? AND source_id = ? AND field = ? AND target_type = 'character' AND target_id = ?`,
          [
            (clash[0]?.count ?? 0) + mention.count,
            mention.source_type,
            mention.source_id,
            mention.field,
            args.targetId,
          ],
        );
        await ctx.tx.query(
          `DELETE FROM mention
            WHERE source_type = ? AND source_id = ? AND field = ? AND target_type = 'character' AND target_id = ?`,
          [mention.source_type, mention.source_id, mention.field, args.sourceId],
        );
        counts.mentionsMerged += 1;
        continue;
      }
      await ctx.tx.query(
        `UPDATE mention SET target_id = ?
          WHERE source_type = ? AND source_id = ? AND field = ? AND target_type = 'character' AND target_id = ?`,
        [args.targetId, mention.source_type, mention.source_id, mention.field, args.sourceId],
      );
      moved.push({
        table: "mention",
        key: JSON.stringify([mention.source_type, mention.source_id, mention.field, args.sourceId]),
      });
      counts.mentionsMoved += 1;
    }

    // Gallery: same shape as scene presence.
    const gallery = await ctx.tx.query<{ attachment_id: string }>(
      "SELECT attachment_id FROM character_gallery WHERE character_id = ?",
      [args.sourceId],
    );
    for (const row of gallery) {
      const clash = await ctx.tx.query<CountRow>(
        "SELECT COUNT(*) AS n FROM character_gallery WHERE character_id = ? AND attachment_id = ?",
        [args.targetId, row.attachment_id],
      );
      if ((clash[0]?.n ?? 0) > 0) {
        await ctx.tx.query(
          "DELETE FROM character_gallery WHERE character_id = ? AND attachment_id = ?",
          [args.sourceId, row.attachment_id],
        );
        counts.galleryDropped += 1;
        continue;
      }
      await ctx.tx.query(
        "UPDATE character_gallery SET character_id = ? WHERE character_id = ? AND attachment_id = ?",
        [args.targetId, args.sourceId, row.attachment_id],
      );
      moved.push({
        table: "character_gallery",
        key: JSON.stringify([args.sourceId, row.attachment_id]),
      });
      counts.galleryMoved += 1;
    }

    // Custom fields: the value's owner moves; an existing target value wins (the writer edited it
    // most recently on the survivor).
    const fields = await ctx.tx.query<{ id: string }>(
      "SELECT id FROM custom_field_value WHERE owner_type = 'character' AND owner_id = ?",
      [args.sourceId],
    );
    for (const row of fields) {
      const clash = await ctx.tx.query<CountRow>(
        `SELECT COUNT(*) AS n FROM custom_field_value
          WHERE owner_type = 'character' AND owner_id = ?
            AND def_id = (SELECT def_id FROM custom_field_value WHERE id = ?)`,
        [args.targetId, row.id],
      );
      if ((clash[0]?.n ?? 0) > 0) {
        await ctx.tx.query("DELETE FROM custom_field_value WHERE id = ?", [row.id]);
        counts.fieldsDropped += 1;
        continue;
      }
      await ctx.tx.query(
        "UPDATE custom_field_value SET owner_id = ?, updated_at = ? WHERE id = ?",
        [args.targetId, now, row.id],
      );
      moved.push({ table: "custom_field_value", key: row.id });
      counts.fieldsMoved += 1;
    }

    // The single-column references: scene POV, timeline lanes, plotline ownership.
    const pov = await ctx.tx.query<{ id: string }>(
      "SELECT id FROM scene WHERE pov_character_id = ? AND deleted_at IS NULL",
      [args.sourceId],
    );
    for (const row of pov) {
      await ctx.tx.query("UPDATE scene SET pov_character_id = ?, updated_at = ? WHERE id = ?", [
        args.targetId,
        now,
        row.id,
      ]);
      moved.push({ table: "scene.pov", key: row.id });
      counts.povMoved += 1;
    }
    const timeline = await ctx.tx.query<{ id: string }>(
      "SELECT id FROM timeline_event WHERE character_id = ?",
      [args.sourceId],
    );
    for (const row of timeline) {
      await ctx.tx.query(
        "UPDATE timeline_event SET character_id = ?, updated_at = ? WHERE id = ?",
        [args.targetId, now, row.id],
      );
      moved.push({ table: "timeline_event", key: row.id });
      counts.timelineMoved += 1;
    }
    const plotlines = await ctx.tx.query<{ id: string }>(
      "SELECT id FROM plotline WHERE character_id = ? AND deleted_at IS NULL",
      [args.sourceId],
    );
    for (const row of plotlines) {
      await ctx.tx.query("UPDATE plotline SET character_id = ?, updated_at = ? WHERE id = ?", [
        args.targetId,
        now,
        row.id,
      ]);
      moved.push({ table: "plotline", key: row.id });
      counts.plotlinesMoved += 1;
    }

    // The source goes to the trash like any delete: 30 days to change your mind.
    await ctx.tx.query("UPDATE character SET deleted_at = ?, updated_at = ? WHERE id = ?", [
      now,
      now,
      args.sourceId,
    ]);

    const changes: ChangeEvent[] = [
      { table: "character", op: "update", id: args.targetId, parentIds: [args.projectId] },
      { table: "character", op: "update", id: args.sourceId, parentIds: [args.projectId] },
      {
        table: "character_relationship",
        op: "update",
        id: args.targetId,
        parentIds: [args.projectId],
      },
      { table: "scene_character", op: "update", id: args.targetId, parentIds: [args.projectId] },
      { table: "mention", op: "update", id: args.targetId, parentIds: [args.projectId] },
      { table: "character_gallery", op: "update", id: args.targetId, parentIds: [args.projectId] },
      { table: "custom_field_value", op: "update", id: args.targetId, parentIds: [args.projectId] },
      { table: "scene", op: "update", id: args.targetId, parentIds: [args.projectId] },
      { table: "timeline_event", op: "update", id: args.targetId, parentIds: [args.projectId] },
      { table: "plotline", op: "update", id: args.targetId, parentIds: [args.projectId] },
    ];
    return {
      result: { sourceId: args.sourceId, targetId: args.targetId, moved, ...counts },
      changes,
    };
  },
};

function parseAliases(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export interface UnmergeCharactersArgs {
  projectId: UUID;
  result: MergeCharactersResult;
}

/**
 * The merge's inverse (spec §2.3.3 point 4's inverse commands): restore the source and put every
 * recorded row back where it was. Rows dropped as duplicates are not restored — their meaning
 * already lives on the target.
 */
export const unmergeCharacters: Command<UnmergeCharactersArgs, { restored: number }> = {
  name: "character.unmerge",
  async run(ctx, args) {
    const { result } = args;
    const now = epochNow();
    let restored = 0;
    for (const move of result.moved) {
      switch (move.table) {
        case "character_relationship":
          await ctx.tx.query(
            `UPDATE character_relationship
                SET source_id = CASE WHEN source_id = ? THEN ? ELSE source_id END,
                    target_id = CASE WHEN target_id = ? THEN ? ELSE target_id END,
                    updated_at = ?
              WHERE id = ?`,
            [result.targetId, result.sourceId, result.targetId, result.sourceId, now, move.key],
          );
          restored += 1;
          break;
        case "scene_character": {
          const [sceneId] = JSON.parse(move.key) as [string, string];
          await ctx.tx.query(
            "UPDATE scene_character SET character_id = ? WHERE scene_id = ? AND character_id = ?",
            [result.sourceId, sceneId, result.targetId],
          );
          restored += 1;
          break;
        }
        case "mention": {
          const [sourceType, sourceId, field] = JSON.parse(move.key) as [
            string,
            string,
            string,
            string,
          ];
          await ctx.tx.query(
            `UPDATE mention SET target_id = ?
              WHERE source_type = ? AND source_id = ? AND field = ? AND target_type = 'character' AND target_id = ?`,
            [result.sourceId, sourceType, sourceId, field, result.targetId],
          );
          restored += 1;
          break;
        }
        case "character_gallery": {
          const [, attachmentId] = JSON.parse(move.key) as [string, string];
          await ctx.tx.query(
            "UPDATE character_gallery SET character_id = ? WHERE character_id = ? AND attachment_id = ?",
            [result.sourceId, result.targetId, attachmentId],
          );
          restored += 1;
          break;
        }
        case "custom_field_value":
          await ctx.tx.query(
            "UPDATE custom_field_value SET owner_id = ?, updated_at = ? WHERE id = ?",
            [result.sourceId, now, move.key],
          );
          restored += 1;
          break;
        case "scene.pov":
          await ctx.tx.query("UPDATE scene SET pov_character_id = ?, updated_at = ? WHERE id = ?", [
            result.sourceId,
            now,
            move.key,
          ]);
          restored += 1;
          break;
        case "timeline_event":
          await ctx.tx.query(
            "UPDATE timeline_event SET character_id = ?, updated_at = ? WHERE id = ?",
            [result.sourceId, now, move.key],
          );
          restored += 1;
          break;
        case "plotline":
          await ctx.tx.query("UPDATE plotline SET character_id = ?, updated_at = ? WHERE id = ?", [
            result.sourceId,
            now,
            move.key,
          ]);
          restored += 1;
          break;
        default:
          break;
      }
    }
    await ctx.tx.query("UPDATE character SET deleted_at = NULL, updated_at = ? WHERE id = ?", [
      now,
      result.sourceId,
    ]);
    const changes: ChangeEvent[] = [
      { table: "character", op: "update", id: result.sourceId, parentIds: [args.projectId] },
      {
        table: "character_relationship",
        op: "update",
        id: result.sourceId,
        parentIds: [args.projectId],
      },
      { table: "scene_character", op: "update", id: result.sourceId, parentIds: [args.projectId] },
      { table: "mention", op: "update", id: result.sourceId, parentIds: [args.projectId] },
      {
        table: "character_gallery",
        op: "update",
        id: result.sourceId,
        parentIds: [args.projectId],
      },
      {
        table: "custom_field_value",
        op: "update",
        id: result.sourceId,
        parentIds: [args.projectId],
      },
      { table: "scene", op: "update", id: result.sourceId, parentIds: [args.projectId] },
      { table: "timeline_event", op: "update", id: result.sourceId, parentIds: [args.projectId] },
      { table: "plotline", op: "update", id: result.sourceId, parentIds: [args.projectId] },
    ];
    return { result: { restored }, changes };
  },
};
