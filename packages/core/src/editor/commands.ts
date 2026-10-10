import type { Command } from "../commands";
import type { UUID } from "../primitives";
import { type EditorState, META_EDITOR_STATE } from "./types";

/**
 * Writes behind writing mode (PLAN slice 13). One command, one transaction: opening a scene for
 * writing is a user action, so it goes through the same layer as every other write and shows up
 * on the change bus (the dashboard card refreshes itself).
 */

export interface SetEditorLastSceneArgs {
  projectId: UUID;
  sceneId: UUID;
}

/** Records "the writer is here" so the next open can resume mid-book. */
export const setEditorLastScene: Command<SetEditorLastSceneArgs, void> = {
  name: "editor.setLastScene",
  async run(ctx, args) {
    const rows = await ctx.tx.query<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [
      META_EDITOR_STATE,
    ]);
    let all: Record<string, EditorState> = {};
    try {
      all = rows[0] ? (JSON.parse(rows[0].value) as Record<string, EditorState>) : {};
    } catch {
      all = {}; // a hand-edited file must not brick the editor
    }
    all[args.projectId] = { lastSceneId: args.sceneId };
    await ctx.tx.query(
      `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [META_EDITOR_STATE, JSON.stringify(all)],
    );
    return {
      result: undefined,
      changes: [
        { table: "meta", op: "update", id: META_EDITOR_STATE, parentIds: [args.projectId] },
      ],
    };
  },
};
