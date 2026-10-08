import type { CharacterContextInfo } from "../characters/types";
import type { Severity, SnowflakeStepNumber, ValidationIssue } from "../entities";
import { countWords } from "../richtext";
import {
  type SnowflakeStepContent,
  STEP2_PARTS,
  type Step1Content,
  type Step2Content,
  type Step3Content,
} from "./types";

export interface ValidateContext {
  /** Known character names + aliases, for the S1_HAS_NAMES heuristic. */
  characterNames?: readonly string[];
  /** The project's characters, for the S3_* rules. */
  characters?: readonly CharacterContextInfo[];
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

/** Dispatcher: validators for steps 4–9 arrive with their slices. */
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
    default:
      return [];
  }
}

/** Errors block completion; warnings are overridable; info never blocks (spec §3.4.1). */
export function blockingIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}
