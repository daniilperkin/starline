import type { ArcType, CharacterRole } from "../entities";
import type { EpochMs, UUID } from "../primitives";

export const CHARACTER_ROLES: readonly CharacterRole[] = [
  "protagonist",
  "antagonist",
  "major",
  "supporting",
  "minor",
  "mentioned",
] as const;

/** Default badge/graph colours per role (star-library palette; user-adjustable per character). */
export const CHARACTER_ROLE_COLORS: Record<CharacterRole, string> = {
  protagonist: "#f6c760",
  antagonist: "#f87171",
  major: "#8b7cf6",
  supporting: "#6ea8fe",
  minor: "#9aa0c0",
  mentioned: "#6b7280",
};

/** Swatches offered by the colour pickers (v1 set; custom colours arrive with the theme work). */
export const CHARACTER_SWATCHES: readonly string[] = [
  "#f6c760",
  "#f87171",
  "#8b7cf6",
  "#6ea8fe",
  "#5ad1a5",
  "#e879b9",
  "#9aa0c0",
  "#6b7280",
];

/** The editable subset used by step 3 cards and the dossier overview (v1). */
export interface CharacterDraft {
  name: string;
  role: CharacterRole;
  color: string;
  arcType: ArcType;
  oneLine: string;
  oneParagraphText: string;
  motivation: string;
  goal: string;
  conflict: string;
  epiphany: string;
}

/** A character row with parsed JSON columns, ordered by `order_key`. */
export interface CharacterSummary extends CharacterDraft {
  id: UUID;
  projectId: UUID;
  aliases: string[];
  orderKey: string;
  updatedAt: EpochMs;
}

/** The slice of a character the S3_* validators read. */
export interface CharacterContextInfo {
  id: UUID;
  role: CharacterRole;
  motivation: string;
  goal: string;
  conflict: string;
  epiphany: string;
}
