import type { EpochMs, UUID } from "./primitives";

export type EntityType =
  | "character"
  | "scene"
  | "chapter"
  | "part"
  | "lore"
  | "note"
  | "plotline"
  | "location"
  | "timeline_event"
  | "project";

export interface EntityRef {
  type: EntityType;
  id: UUID;
}

export interface Timestamps {
  createdAt: EpochMs;
  updatedAt: EpochMs;
  deletedAt: EpochMs | null;
}

export type StoryForm =
  | "novel"
  | "novella"
  | "short_story"
  | "fairy_tale"
  | "fanfiction"
  | "screenplay_treatment";

export type PlanningMethod = "snowflake" | "freeform";

export type SnowflakeStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type StepStatus = "not_started" | "in_progress" | "complete";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  /** Stable id, e.g. "S1_TOO_LONG". */
  code: string;
  /** "error" blocks completion; "warning" can be overridden. */
  severity: Severity;
  /** User-facing; i18n key resolved by the UI. */
  message: string;
  /** JSON pointer within the step content. */
  field?: string;
}

export type CharacterRole =
  | "protagonist"
  | "antagonist"
  | "major"
  | "supporting"
  | "minor"
  | "mentioned";

export type ArcType =
  | "positive_change"
  | "flat"
  | "negative_fall"
  | "negative_corruption"
  | "negative_disillusionment"
  | "none";

export type RelationshipKind =
  | "family_parent"
  | "family_child"
  | "family_sibling"
  | "family_spouse"
  | "family_other"
  | "romantic"
  | "friend"
  | "ally"
  | "rival"
  | "enemy"
  | "mentor"
  | "mentee"
  | "employer"
  | "employee"
  | "servant"
  | "master"
  | "acquaintance"
  | "custom";

export type SceneStatus = "idea" | "outlined" | "drafting" | "drafted" | "revising" | "done";
export type SceneOutcome = "yes" | "no" | "yes_but" | "no_and" | "unresolved";
export type TimeOfDay =
  | "dawn"
  | "morning"
  | "noon"
  | "afternoon"
  | "evening"
  | "night"
  | "unspecified";

export type LoreKind =
  | "location"
  | "faction"
  | "magic_system"
  | "technology"
  | "geography"
  | "history_event"
  | "culture"
  | "religion"
  | "politics"
  | "economy"
  | "species"
  | "language"
  | "item"
  | "organization"
  | "antagonistic_force"
  | "custom";

export type LinkKind =
  | "member_of"
  | "located_in"
  | "rules"
  | "worships"
  | "allied_with"
  | "at_war_with"
  | "created_by"
  | "uses"
  | "related";

export type NoteStatus = "inbox" | "incubating" | "used" | "archived";
export type NoteKind = "idea" | "research" | "dialogue" | "scene_seed" | "question" | "todo";

export type CustomFieldType =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "boolean"
  | "select"
  | "multiselect"
  | "url"
  | "color"
  | "entity_ref";

export type CustomFieldTarget = "character" | "lore" | "scene" | "location";

export type ModuleName =
  | "snowflake"
  | "characters"
  | "graph"
  | "outliner"
  | "timeline"
  | "wiki"
  | "notes";

export type SceneStatusPalette = Record<SceneStatus, `#${string}`>;
