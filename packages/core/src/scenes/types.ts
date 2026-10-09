import type { SceneOutcome, SceneStatus, TimeOfDay } from "../entities";
import type { EpochMs, OrderKey, UUID } from "../primitives";
import type { RichText } from "../richtext";

/** Scene statuses in workflow order (spec §3.6). */
export const SCENE_STATUSES: readonly SceneStatus[] = [
  "idea",
  "outlined",
  "drafting",
  "drafted",
  "revising",
  "done",
] as const;

/** Status pill colours (star-library palette; user-renameable later with the Statuses setting). */
export const SCENE_STATUS_COLORS: Record<SceneStatus, string> = {
  idea: "#9aa0c0",
  outlined: "#6ea8fe",
  drafting: "#f6c760",
  drafted: "#5ad1a5",
  revising: "#8b7cf6",
  done: "#34d399",
};

/** Outcome segmented control options (spec §3.6, scene editor order). */
export const SCENE_OUTCOMES: readonly SceneOutcome[] = [
  "yes",
  "no",
  "yes_but",
  "no_and",
  "unresolved",
] as const;

export const TIME_OF_DAY_OPTIONS: readonly TimeOfDay[] = [
  "dawn",
  "morning",
  "noon",
  "afternoon",
  "evening",
  "night",
  "unspecified",
] as const;

export const PRESENCES = ["present", "mentioned", "offstage"] as const;
export type Presence = (typeof PRESENCES)[number];

export const PLOTLINE_KINDS = ["main", "subplot", "character_arc", "mystery", "theme"] as const;
export type PlotlineKind = (typeof PLOTLINE_KINDS)[number];

export const PLOTLINE_KIND_COLORS: Record<PlotlineKind, string> = {
  main: "#f6c760",
  subplot: "#6ea8fe",
  character_arc: "#8b7cf6",
  mystery: "#e879b9",
  theme: "#5ad1a5",
};

/** Tag chip colours; a new tag picks one deterministically from its name (tag manager later). */
export const TAG_COLORS: readonly string[] = [
  "#f6c760",
  "#6ea8fe",
  "#8b7cf6",
  "#e879b9",
  "#5ad1a5",
  "#f87171",
  "#9aa0c0",
];

export function tagColorFor(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  return TAG_COLORS[hash % TAG_COLORS.length] ?? "#6ea8fe";
}

/** Provenance for re-sync (spec §3.6): scenes created from a step-8 paste keep their line. */
export interface SnowflakeSource {
  step: 8 | 9;
  line: number;
  /** The original step-8 one-line, kept so step 9's "Copy to scene synopsis" can always
   *  restore it (older rows predate the field — callers fall back to the synopsis text). */
  oneLine?: string;
}

/** The editable scalar subset of a scene — the scene editor's fields minus joins. */
export interface SceneDraft {
  title: string;
  status: SceneStatus;
  povCharacterId: UUID | null;
  locationId: UUID | null;
  objective: string;
  obstacle: string;
  outcome: SceneOutcome;
  outcomeNote: string;
  emotionStart: string;
  emotionEnd: string;
  storyTime: number | null;
  storyTimeLabel: string;
  timeOfDay: TimeOfDay;
  targetWordCount: number | null;
}

/** A scene row (list shape) with resolved POV/location names for the outliner rows. */
export interface SceneSummary extends SceneDraft {
  id: UUID;
  projectId: UUID;
  chapterId: UUID | null;
  orderKey: OrderKey;
  synopsis: RichText;
  bodyWordCount: number;
  povName: string | null;
  locationName: string | null;
  snowflakeSource: SnowflakeSource | null;
  createdAt: EpochMs;
  updatedAt: EpochMs;
}

/** A scene with its joins — what the editor sheet loads. */
export interface SceneDetail extends SceneSummary {
  presentCharacterIds: UUID[];
  loreIds: UUID[];
  plotlines: Array<{ plotlineId: UUID; beat: string }>;
  tagIds: UUID[];
}

/** The slice of a scene the S8_* / S9_* validators read. */
export interface SceneContextInfo {
  id: UUID;
  povCharacterId: UUID | null;
  chapterId: UUID | null;
  /** Plain-text word count of the scene synopsis (S9_SCENE_THIN, spec §3.4.2). */
  synopsisWords: number;
}

export interface PartSummary {
  id: UUID;
  projectId: UUID;
  title: string;
  orderKey: OrderKey;
  color: string | null;
}

export interface ChapterSummary {
  id: UUID;
  projectId: UUID;
  partId: UUID | null;
  title: string;
  orderKey: OrderKey;
  color: string | null;
}

export interface PlotlineSummary {
  id: UUID;
  projectId: UUID;
  name: string;
  kind: PlotlineKind;
  color: string;
  characterId: UUID | null;
  orderKey: OrderKey;
}

export interface TagSummary {
  id: UUID;
  projectId: UUID;
  name: string;
  color: string;
}
