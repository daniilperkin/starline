import type { CharacterContextInfo } from "../characters/types";
import type { Severity, SnowflakeStepNumber, ValidationIssue } from "../entities";
import type { UUID } from "../primitives";
import { countWords } from "../richtext";
import type { SceneContextInfo } from "../scenes/types";
import {
  EXPANSION_KEYS,
  type ExpansionKey,
  type SnowflakeStepContent,
  STEP2_PARTS,
  type Step1Content,
  type Step2Content,
  type Step3Content,
  type Step4Content,
  type Step5Content,
  type Step6Content,
  type Step8Content,
} from "./types";

export interface ValidateContext {
  /** Known character names + aliases, for the S1_HAS_NAMES heuristic. */
  characterNames?: readonly string[];
  /** The project's characters, for the S3_* and S5_* rules. */
  characters?: readonly CharacterContextInfo[];
  /** Step 3's major-character selection, for the S5_* rules. */
  majorCharacterIds?: readonly UUID[];
  /** The project's scenes (light slice), for the S8_* rules. */
  scenes?: readonly SceneContextInfo[];
}

const QUOTED_RE = /"[^"]*"|“[^”]*”|‘[^’]*’|'[^']*'/g;
const TERMINATOR_RE = /[.!?]+/g;

/**
 * Terminators sitting *inside* the text — a trailing "." is just punctuation, not a second
 * sentence. Quotes and decimals are excluded; the rules are advisory heuristics.
 */
function countInnerSentenceEnds(text: string): number {
  const withoutQuotes = text.replace(QUOTED_RE, " ");
  const withoutDecimals = withoutQuotes.replace(/(\d)\.(?=\d)/g, "$1");
  const withoutTrailing = withoutDecimals.replace(/[\s.!?…]+$/u, "");
  return (withoutTrailing.match(TERMINATOR_RE) ?? []).length;
}

function issue(code: string, severity: Severity, field: string): ValidationIssue {
  return { code, severity, message: `issues.${code}`, field };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive whole-word match (Unicode-aware). */
function containsName(text: string, name: string): boolean {
  const needle = name.trim();
  if (needle.length < 2) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, "iu").test(
    text,
  );
}

function significantWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((word) => word.length >= 4);
  return new Set(words);
}

function sharesSignificantWord(a: string, b: string): boolean {
  const wordsA = significantWords(a);
  if (wordsA.size === 0) return true; // nothing to compare — don't nag
  for (const word of significantWords(b)) {
    if (wordsA.has(word)) return true;
  }
  return false;
}

/** Spec §3.4.2 — S1_* rules. */
export function validateStep1(content: Step1Content, ctx: ValidateContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sentence = content.sentence.trim();
  if (sentence.length === 0) {
    return [issue("S1_EMPTY", "error", "/sentence")];
  }
  if (countWords(sentence) > 25) issues.push(issue("S1_TOO_LONG", "warning", "/sentence"));
  if (countInnerSentenceEnds(sentence) > 0)
    issues.push(issue("S1_MULTI_SENTENCE", "warning", "/sentence"));
  const names = ctx.characterNames ?? [];
  if (names.some((name) => containsName(sentence, name))) {
    issues.push(issue("S1_HAS_NAMES", "warning", "/sentence"));
  }
  return issues;
}

/** Spec §3.4.2 — S2_* rules. */
export function validateStep2(content: Step2Content): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const part of STEP2_PARTS) {
    if (content[part].trim().length === 0) {
      issues.push(issue("S2_MISSING_PART", "error", `/${part}`));
    }
  }
  for (const part of STEP2_PARTS) {
    const text = content[part].trim();
    if (text.length > 0 && countInnerSentenceEnds(text) > 0) {
      issues.push(issue("S2_NOT_ONE_SENTENCE", "warning", `/${part}`));
    }
  }
  const setup = content.setup.trim();
  const ending = content.ending.trim();
  if (setup.length > 0 && ending.length > 0 && !sharesSignificantWord(setup, ending)) {
    issues.push(issue("S2_ENDING_UNRESOLVED", "info", "/ending"));
  }
  return issues;
}

/** Spec §3.4.2 — S3_* rules. */
export function validateStep3(content: Step3Content, ctx: ValidateContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const characters = ctx.characters ?? [];
  const byId = new Map(characters.map((character) => [character.id, character]));
  if (!content.skipped && content.majorCharacterIds.length === 0) {
    issues.push(issue("S3_NO_MAJOR", "error", "/majorCharacterIds"));
  }
  for (const id of content.majorCharacterIds) {
    const character = byId.get(id);
    if (!character) continue; // deleted characters are ignored, not flagged
    const missing = [
      character.motivation,
      character.goal,
      character.conflict,
      character.epiphany,
    ].some((value) => value.trim().length === 0);
    if (missing) issues.push(issue("S3_FIELD_MISSING", "warning", "/majorCharacterIds"));
  }
  if (characters.length > 0 && !characters.some((character) => character.role === "antagonist")) {
    issues.push(issue("S3_NO_ANTAGONISTIC_FORCE", "info", "/majorCharacterIds"));
  }
  return issues;
}

/** Spec §3.4.2 — S4_* rules. */
export function validateStep4(content: Step4Content): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byKey = new Map(content.paragraphs.map((paragraph) => [paragraph.sourceKey, paragraph]));
  const words = new Map<ExpansionKey, number>();
  for (const key of EXPANSION_KEYS) {
    const text = byKey.get(key)?.text.text.trim() ?? "";
    words.set(key, countWords(text));
    if (text.length === 0) issues.push(issue("S4_PARAGRAPH_EMPTY", "error", `/${key}`));
  }
  // Prompt to raise the stakes when the second disaster reads thin against the rest.
  const others = (["setup", "disaster1", "disaster3", "ending"] as const)
    .map((key) => words.get(key) ?? 0)
    .sort((a, b) => a - b);
  const median = ((others[1] ?? 0) + (others[2] ?? 0)) / 2;
  const disaster2 = words.get("disaster2") ?? 0;
  if (disaster2 > 0 && median > 0 && disaster2 < 0.4 * median) {
    issues.push(issue("S4_DISASTER_ORDER", "info", "/disaster2"));
  }
  return issues;
}

/** Spec §3.4.2 — S5_* rules: a major character with an empty storyline warns. */
export function validateStep5(
  _content: Step5Content,
  ctx: ValidateContext = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map((ctx.characters ?? []).map((character) => [character.id, character]));
  for (const id of ctx.majorCharacterIds ?? []) {
    const character = byId.get(id);
    if (!character) continue; // deleted characters are ignored, not flagged
    if (character.storyline.trim().length === 0) {
      issues.push(issue("S5_NOT_REVIEWED", "warning", "/reviewedCharacterIds"));
    }
  }
  return issues;
}

/** Spec §3.4.2 — S6_* rules (decision 3: five sections, 1:1 with the step-4 paragraphs). */
export function validateStep6(content: Step6Content): ValidationIssue[] {
  const nonEmpty = content.sections.filter((section) => section.text.text.trim().length > 0).length;
  if (nonEmpty < 4) return [issue("S6_SECTION_EMPTY", "error", "/sections")];
  return [];
}

/**
 * Spec §3.4.2 — S8_* rules: the step is about the scene list, so the checks read the
 * `scene` table (via `ctx.scenes`), not the step content. Without scene context the
 * validators stay silent rather than guessing.
 */
export function validateStep8(
  _content: Step8Content,
  ctx: ValidateContext = {},
): ValidationIssue[] {
  if (ctx.scenes === undefined) return [];
  const scenes = ctx.scenes;
  if (scenes.length === 0) return [issue("S8_NO_SCENES", "error", "/scenes")];
  const issues: ValidationIssue[] = [];
  if (scenes.some((scene) => scene.povCharacterId === null)) {
    issues.push(issue("S8_SCENE_NO_POV", "warning", "/scenes"));
  }
  if (scenes.some((scene) => scene.chapterId === null)) {
    issues.push(issue("S8_UNASSIGNED", "info", "/scenes"));
  }
  return issues;
}

/** Dispatcher: validators for steps 7 and 9 arrive with their slices. */
export function validateStep(
  step: SnowflakeStepNumber,
  content: SnowflakeStepContent,
  ctx: ValidateContext = {},
): ValidationIssue[] {
  switch (step) {
    case 1:
      return validateStep1(content as Step1Content, ctx);
    case 2:
      return validateStep2(content as Step2Content);
    case 3:
      return validateStep3(content as Step3Content, ctx);
    case 4:
      return validateStep4(content as Step4Content);
    case 5:
      return validateStep5(content as Step5Content, ctx);
    case 6:
      return validateStep6(content as Step6Content);
    case 8:
      return validateStep8(content as Step8Content, ctx);
    default:
      return [];
  }
}

/** Errors block completion; warnings are overridable; info never blocks (spec §3.4.1). */
export function blockingIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}
