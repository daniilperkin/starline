import { z } from "zod";
import type { SceneStatusPalette } from "./entities";

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const timelineCalendarSchema = z.object({
  kind: z.enum(["gregorian", "custom"]),
  /** "AD", "Third Age", … */
  eraLabel: z.string().max(40),
  /** Custom calendar only; same length as daysPerMonth when custom. */
  monthNames: z.array(z.string().min(1).max(40)).min(1).max(24).nullable(),
  daysPerMonth: z.array(z.number().int().min(1).max(366)).min(1).max(24).nullable(),
  /** 24 for Earth. */
  hoursPerDay: z.number().int().min(1).max(1000),
});
export type TimelineCalendar = z.infer<typeof timelineCalendarSchema>;

export const sceneStatusPaletteSchema = z.object({
  idea: hexColorSchema,
  outlined: hexColorSchema,
  drafting: hexColorSchema,
  drafted: hexColorSchema,
  revising: hexColorSchema,
  done: hexColorSchema,
});

/** Project settings JSON column shape (spec §3.3), validated by Zod on read and write. */
export const projectSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  /** BCP-47, e.g. "en". */
  language: z.string().min(2).max(35),
  wordsPerPageEstimate: z.number().int().min(1).max(10000),
  defaultSceneTargetWords: z.number().int().min(1).max(1000000),
  povLabel: z.enum(["POV", "Viewpoint", "Narrator"]),
  statusPalette: sceneStatusPaletteSchema,
  timelineCalendar: timelineCalendarSchema,
  enabledModules: z.array(
    z.enum(["snowflake", "characters", "graph", "outliner", "timeline", "wiki", "notes"]),
  ),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const DEFAULT_STATUS_PALETTE: SceneStatusPalette = {
  idea: "#8a8a8a",
  outlined: "#4f83cc",
  drafting: "#c98a2e",
  drafted: "#5aa469",
  revising: "#a15abf",
  done: "#2f9e6e",
};

export const DEFAULT_TIMELINE_CALENDAR: TimelineCalendar = {
  kind: "gregorian",
  eraLabel: "AD",
  monthNames: null,
  daysPerMonth: null,
  hoursPerDay: 24,
};

export function defaultProjectSettings(): ProjectSettings {
  return {
    schemaVersion: 1,
    language: "en",
    wordsPerPageEstimate: 300,
    defaultSceneTargetWords: 1500,
    povLabel: "POV",
    statusPalette: { ...DEFAULT_STATUS_PALETTE },
    timelineCalendar: { ...DEFAULT_TIMELINE_CALENDAR },
    enabledModules: ["snowflake", "characters", "graph", "outliner", "timeline", "wiki", "notes"],
  };
}
