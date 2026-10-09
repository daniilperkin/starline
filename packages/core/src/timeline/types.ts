import type { SceneStatus } from "../entities";
import type { UUID } from "../primitives";
import type { TimelineCalendar } from "../settings";

/**
 * Timeline (spec §4.4.1, §5.7 slice 10). `storyTime` is SECONDS since the calendar's epoch and
 * may be negative (spec §3.3 `TimelineEvent.storyTime`), which is what makes one number work
 * for hours and for millennia: every zoom level is just a different seconds-per-pixel.
 */

export const TIMELINE_LANES = ["world", "character", "plot"] as const;
export type TimelineLaneKind = (typeof TIMELINE_LANES)[number];

/**
 * Zoom levels, hours → millennia (spec §4.4.1). `spanSeconds` is the window a phone-width
 * viewport shows; the UI derives seconds-per-pixel from it, so the same number drives both the
 * scale and the tick density.
 */
export interface TimelineZoom {
  id: string;
  label: string;
  spanSeconds: number;
}

export const HOUR = 3600;
export const DAY = 24 * HOUR;

export const TIMELINE_ZOOMS: readonly TimelineZoom[] = [
  { id: "hours", label: "Hours", spanSeconds: 6 * HOUR },
  { id: "days", label: "Days", spanSeconds: 14 * DAY },
  { id: "weeks", label: "Weeks", spanSeconds: 70 * DAY },
  { id: "months", label: "Months", spanSeconds: 730 * DAY },
  { id: "years", label: "Years", spanSeconds: 20 * 365.2425 * DAY },
  { id: "decades", label: "Decades", spanSeconds: 200 * 365.2425 * DAY },
  { id: "centuries", label: "Centuries", spanSeconds: 2000 * 365.2425 * DAY },
  { id: "millennia", label: "Millennia", spanSeconds: 20000 * 365.2425 * DAY },
];

export function zoomById(id: string): TimelineZoom {
  return TIMELINE_ZOOMS.find((zoom) => zoom.id === id) ?? (TIMELINE_ZOOMS[4] as TimelineZoom);
}

export interface TimelineSceneItem {
  kind: "scene";
  id: UUID;
  title: string;
  storyTime: number;
  storyTimeEnd: number | null;
  storyTimeLabel: string;
  status: SceneStatus;
  povName: string | null;
  locationName: string | null;
}

export interface TimelineEventItem {
  kind: "event";
  id: UUID;
  title: string;
  storyTime: number;
  storyTimeEnd: number | null;
  storyTimeLabel: string;
  lane: TimelineLaneKind;
  characterId: UUID | null;
  plotlineId: UUID | null;
  color: string | null;
  sceneId: UUID | null;
  loreEntryId: UUID | null;
  /** Plain-text notes; the editor round-trips these, the rich text stays in the row. */
  description: string;
}

export type TimelineItem = TimelineSceneItem | TimelineEventItem;

export interface TimelineLane {
  /** `world`, `character:<id>`, `plot:<id>` — stable keys for the UI. */
  id: string;
  kind: TimelineLaneKind;
  label: string;
  color: string | null;
  characterId: UUID | null;
  plotlineId: UUID | null;
  items: TimelineItem[];
}

export interface TimelineConflict {
  characterId: UUID;
  characterName: string;
  sceneAId: UUID;
  sceneATitle: string;
  sceneALocation: string;
  sceneBId: UUID;
  sceneBTitle: string;
  sceneBLocation: string;
}

export interface NoTimeScene {
  id: UUID;
  title: string;
  status: SceneStatus;
}

export interface TimelineData {
  calendar: TimelineCalendar;
  lanes: TimelineLane[];
  noTime: NoTimeScene[];
  conflicts: TimelineConflict[];
  /** Min/max storyTime across every placed item; null when nothing is placed yet. */
  range: { start: number; end: number } | null;
}

/**
 * A scene's story footprint: the spec has no end time on scenes, so a scene occupies a nominal
 * window. Documented here rather than hidden in the conflict query — the day scenes gain a real
 * end time, only this constant changes.
 */
export const NOMINAL_SCENE_SECONDS = HOUR;
