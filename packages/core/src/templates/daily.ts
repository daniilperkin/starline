import type { SnowflakeStepNumber } from "../entities";
import { STEP_PROMPTS } from "../snowflake/prompts";
import { STEP_PROMPTS_UK } from "../snowflake/prompts-uk";

/**
 * The offline daily inspiration card (slice 16, decision 24 phase 2).
 *
 * One reflective question a day, drawn from the bundled prompt library, deterministic for a given
 * calendar date: the same day always shows the same question, and the card needs no network, no
 * storage and no server to decide what "today" means. Seeding on the local date (rather than, say,
 * a counter) is what makes it stable across reloads and reinstalls without persisting anything.
 */

export type PromptLocale = "en" | "uk";

export interface DailyPrompt {
  /** Which step of the method the question belongs to — shown as context on the card. */
  step: SnowflakeStepNumber;
  question: string;
}

const STEP_NUMBERS: SnowflakeStepNumber[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function promptsFor(locale: PromptLocale) {
  return locale === "uk" ? STEP_PROMPTS_UK : STEP_PROMPTS;
}

/** Every question in the library, in a stable order: step by step, question by question. */
export function promptPool(locale: PromptLocale): DailyPrompt[] {
  const source = promptsFor(locale);
  const pool: DailyPrompt[] = [];
  for (const step of STEP_NUMBERS) {
    for (const question of source[step].questions) {
      pool.push({ step, question });
    }
  }
  return pool;
}

/** FNV-1a, so the pick depends on the date text and nothing else. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/** The local calendar date as a stable key — deliberately not UTC, because "today" is local. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's question. Same date in, same question out — always. */
export function dailyPrompt(date: Date, locale: PromptLocale): DailyPrompt {
  const pool = promptPool(locale);
  const index = hash(dayKey(date)) % pool.length;
  return pool[index] ?? { step: 1, question: "" };
}
