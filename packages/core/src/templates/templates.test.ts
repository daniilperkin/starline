import { describe, expect, it } from "vitest";
import { parseSceneList } from "../scenes/parse";
import { STEP_PROMPTS } from "../snowflake/prompts";
import { STEP_PROMPTS_DE } from "../snowflake/prompts-de";
import { STEP_PROMPTS_UK } from "../snowflake/prompts-uk";
import { TEMPLATE_CONTENT, TEMPLATE_IDS, templateSceneText } from "./beats";
import { dailyPrompt, dayKey, promptPool } from "./daily";

const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

describe("structure templates", () => {
  it("has content for every template in every locale", () => {
    for (const id of TEMPLATE_IDS) {
      for (const locale of ["en", "uk", "de"] as const) {
        const content = TEMPLATE_CONTENT[id][locale];
        expect(content.name.length).toBeGreaterThan(0);
        expect(content.summary.length).toBeGreaterThan(0);
        expect(content.beats.length).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("keeps the locales in step, beat for beat", () => {
    for (const id of TEMPLATE_IDS) {
      const en = TEMPLATE_CONTENT[id].en;
      for (const locale of ["uk", "de"] as const) {
        const other = TEMPLATE_CONTENT[id][locale];
        expect(other.beats.length).toBe(en.beats.length);
        // Titles and synopses differ by language, so the check is structural: every beat exists,
        // every field is filled, and no synopsis is accidentally left in English. Titles may
        // coincide for a loanword ("Finale" is German too) — but only for a loanword, so at most
        // a couple per template are allowed to match.
        let sameTitles = 0;
        for (let index = 0; index < en.beats.length; index++) {
          const english = en.beats[index];
          const translated = other.beats[index];
          expect(english).toBeDefined();
          expect(translated).toBeDefined();
          expect(translated?.title.length).toBeGreaterThan(0);
          expect(translated?.synopsis.length).toBeGreaterThan(0);
          expect(translated?.synopsis).not.toBe(english?.synopsis);
          if (translated?.title === english?.title) sameTitles++;
        }
        expect(sameTitles).toBeLessThanOrEqual(2);
      }
    }
  });

  it("never puts a cell separator inside a beat", () => {
    for (const id of TEMPLATE_IDS) {
      for (const locale of ["en", "uk", "de"] as const) {
        for (const beat of TEMPLATE_CONTENT[id][locale].beats) {
          expect(beat.title).not.toContain("|");
          expect(beat.title).not.toContain("\t");
          expect(beat.synopsis).not.toContain("|");
          expect(beat.synopsis).not.toContain("\t");
        }
      }
    }
  });

  it("generates text the scene-list parser reads as exactly one scene per beat", () => {
    for (const id of TEMPLATE_IDS) {
      for (const locale of ["en", "uk", "de"] as const) {
        const beats = TEMPLATE_CONTENT[id][locale].beats;
        const parsed = parseSceneList(templateSceneText(id, locale), { titleColumn: true });
        expect(parsed.rows.length).toBe(beats.length);
        expect(parsed.skipped.length).toBe(0);
        // Title and synopsis land in the right fields, and nothing becomes a POV or a chapter:
        // template scenes arrive unassigned, which is the shape the wizard's step 8 expects.
        for (let index = 0; index < beats.length; index++) {
          const row = parsed.rows[index];
          expect(row?.title).toBe(beats[index]?.title);
          expect(row?.oneLine).toBe(beats[index]?.synopsis);
          expect(row?.povName ?? null).toBeNull();
          expect(row?.chapterTitle ?? null).toBeNull();
        }
      }
    }
  });
});

describe("the prompt library in Ukrainian", () => {
  it("covers every step, with the same example and question counts", () => {
    for (const step of STEPS) {
      const en = STEP_PROMPTS[step];
      const uk = STEP_PROMPTS_UK[step];
      expect(uk.rule.length).toBeGreaterThan(0);
      expect(uk.examples.length).toBe(en.examples.length);
      expect(uk.questions.length).toBe(en.questions.length);
      for (let index = 0; index < en.examples.length; index++) {
        expect(uk.examples[index]?.source.length).toBeGreaterThan(0);
        expect(uk.examples[index]?.text.length).toBeGreaterThan(0);
      }
      for (let index = 0; index < en.questions.length; index++) {
        expect(uk.questions[index]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("is actually translated, not copied", () => {
    for (const step of STEPS) {
      expect(STEP_PROMPTS_UK[step].rule).not.toBe(STEP_PROMPTS[step].rule);
      expect(STEP_PROMPTS_UK[step].questions[0]).not.toBe(STEP_PROMPTS[step].questions[0]);
    }
  });
});

describe("the prompt library in German", () => {
  it("covers every step, with the same example and question counts", () => {
    for (const step of STEPS) {
      const en = STEP_PROMPTS[step];
      const de = STEP_PROMPTS_DE[step];
      expect(de.rule.length).toBeGreaterThan(0);
      expect(de.examples.length).toBe(en.examples.length);
      expect(de.questions.length).toBe(en.questions.length);
      for (let index = 0; index < en.examples.length; index++) {
        expect(de.examples[index]?.source.length).toBeGreaterThan(0);
        expect(de.examples[index]?.text.length).toBeGreaterThan(0);
      }
      for (let index = 0; index < en.questions.length; index++) {
        expect(de.questions[index]?.length).toBeGreaterThan(0);
      }
    }
  });

  it("is actually translated, not copied", () => {
    for (const step of STEPS) {
      expect(STEP_PROMPTS_DE[step].rule).not.toBe(STEP_PROMPTS[step].rule);
      expect(STEP_PROMPTS_DE[step].questions[0]).not.toBe(STEP_PROMPTS[step].questions[0]);
    }
  });
});

describe("the daily inspiration card", () => {
  it("is deterministic for a given day", () => {
    const day = new Date(2026, 9, 12);
    const first = dailyPrompt(day, "en");
    const second = dailyPrompt(new Date(2026, 9, 12, 23, 59), "en");
    expect(second).toEqual(first);
  });

  it("changes from one day to the next most of the time, and stays inside the pool", () => {
    const seen = new Set<string>();
    let changes = 0;
    let previous: string | null = null;
    for (let offset = 0; offset < 400; offset++) {
      const day = new Date(2026, 0, 1 + offset);
      const pick = dailyPrompt(day, "en");
      const pool = promptPool("en");
      expect(pick.question.length).toBeGreaterThan(0);
      expect(pool).toContainEqual(pick);
      seen.add(`${pick.step}:${pick.question}`);
      if (previous !== null && `${pick.step}:${pick.question}` !== previous) changes++;
      previous = `${pick.step}:${pick.question}`;
    }
    // Not every consecutive day differs (the pool is finite), but the vast majority must.
    expect(changes).toBeGreaterThan(300);
    expect(seen.size).toBeGreaterThan(30);
  });

  it("draws from every step of the method across a year", () => {
    const steps = new Set<number>();
    for (let offset = 0; offset < 365; offset++) {
      steps.add(dailyPrompt(new Date(2026, 0, 1 + offset), "uk").step);
    }
    expect(steps.size).toBe(9);
  });

  it("keeps the pool non-empty in both locales and keys days by the local date", () => {
    expect(promptPool("en").length).toBeGreaterThan(40);
    expect(promptPool("uk").length).toBe(promptPool("en").length);
    expect(promptPool("de").length).toBe(promptPool("en").length);
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});
