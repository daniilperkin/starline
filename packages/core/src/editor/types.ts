import type { SceneStatus } from "../entities";
import type { EpochMs, UUID } from "../primitives";
import type { RichText } from "../richtext";

/**
 * Writing-mode state (PLAN slice 13). Where the writer stopped last lives in the library file,
 * not the device: "continue writing" should follow the .starline to a new phone. Everything
 * device-specific (caret position, type size, serif) stays in localStorage — see the web layer.
 */

/** One `meta` JSON blob, nested per project — same shape as the graph pins (spec §4.2.3). */
export const META_EDITOR_STATE = "editor_state";

export interface EditorState {
  /** The scene the writer last had open in writing mode; null before the first write. */
  lastSceneId: UUID | null;
}

/** What the dashboard's "Continue writing" card opens. */
export interface ContinueTarget {
  sceneId: UUID;
  title: string;
  chapterId: UUID | null;
  wordCount: number;
  targetWordCount: number | null;
  status: SceneStatus;
  /** "last" = where the writer stopped; "next" = the first scene not yet marked done. */
  reason: "last" | "next";
}

/** The draft body plus its denormalised count — what writing mode loads. */
export interface SceneBody {
  body: RichText;
  updatedAt: EpochMs;
}
