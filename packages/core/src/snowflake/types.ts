import type { SnowflakeStepNumber, StepStatus } from "../entities";
import type { EpochMs, UUID } from "../primitives";
import type { RichText } from "../richtext";

/** Steps 1–9, in order (spec §3.4). */
export const STEP_NUMBERS: readonly SnowflakeStepNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Step 1 content (spec §3.4). */
export interface Step1Content {
  sentence: string;
  alternatives: Array<{ id: UUID; text: string; createdAt: EpochMs }>;
}

/** Step 2 content — the classic five-sentence "three-disaster" structure. */
export interface Step2Content {
  setup: string;
  disaster1: string;
  disaster2: string;
  disaster3: string;
  ending: string;
}

export const STEP2_PARTS = ["setup", "disaster1", "disaster2", "disaster3", "ending"] as const;
export type Step2Part = (typeof STEP2_PARTS)[number];

/** Step 3 — which characters have been summarised. */
export interface Step3Content {
  majorCharacterIds: UUID[];
  skipped: boolean;
}

/** The five source keys every expansion step works from (step 2 sentence → step 4 paragraph → step 6 section). */
export const EXPANSION_KEYS = ["setup", "disaster1", "disaster2", "disaster3", "ending"] as const;
export type ExpansionKey = (typeof EXPANSION_KEYS)[number];

/** Step 4 — five paragraphs, each expanding one step-2 sentence. */
export interface Step4Content {
  paragraphs: Array<{ sourceKey: ExpansionKey; text: RichText }>;
}

/** Step 5 — reviewed character storylines. */
export interface Step5Content {
  reviewedCharacterIds: UUID[];
}

/** Step 6 — four sections expanding step 4. */
export interface Step6Content {
  sections: Array<{ sourceKey: ExpansionKey; text: RichText }>;
}

/** Step 7 — completed character charts. */
export interface Step7Content {
  completedCharacterIds: UUID[];
}

/** Step 8 — bookkeeping for the scene-list extraction trigger. */
export interface Step8Content {
  generatedSceneIds: UUID[];
  lastImportedAt: EpochMs | null;
}

/** Step 9 — expanded scene synopses. */
export interface Step9Content {
  expandedSceneIds: UUID[];
  skipped: boolean;
}

export interface StepContentMap {
  1: Step1Content;
  2: Step2Content;
  3: Step3Content;
  4: Step4Content;
  5: Step5Content;
  6: Step6Content;
  7: Step7Content;
  8: Step8Content;
  9: Step9Content;
}

export type SnowflakeStepContent = StepContentMap[SnowflakeStepNumber];

/** A `snowflake_step` row with parsed JSON columns. */
export interface SnowflakeStepRow {
  id: UUID;
  projectId: UUID;
  step: SnowflakeStepNumber;
  status: StepStatus;
  content: SnowflakeStepContent;
  completedAt: EpochMs | null;
  overrides: string[];
  updatedAt: EpochMs;
}
