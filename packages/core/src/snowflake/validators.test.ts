import { describe, expect, it } from "vitest";
import { en } from "../i18n";
import type { Step1Content, Step2Content } from "./types";
import {
  blockingIssues,
  type ValidateContext,
  validateStep,
  validateStep1,
  validateStep2,
} from "./validators";

const step1 = (sentence: string): Step1Content => ({ sentence, alternatives: [] });
const step2 = (parts: Partial<Step2Content>): Step2Content => ({
  setup: "",
  disaster1: "",
  disaster2: "",
  disaster3: "",
  ending: "",
  ...parts,
});

const GOOD_S1 =
  "A grieving cartographer must map a shifting island before it sinks and takes her sister with it";
const GOOD_S2: Step2Content = {
  setup: "A quiet harbour town thrives on the trade winds.",
  disaster1: "The winds vanish and the fleet is stranded.",
  disaster2: "A rival fleet arrives to claim the harbour.",
  disaster3: "The harbour burns and the townsfolk scatter.",
  ending: "The harbour is rebuilt from the ruins of the fleet.",
};

describe("validateStep1", () => {
  it("S1_EMPTY: empty sentence is the only issue (error)", () => {
    const issues = validateStep1(step1("  "));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("S1_EMPTY");
    expect(issues[0]?.severity).toBe("error");
  });

  it("a good 15–25 word sentence yields no issues", () => {
    expect(validateStep1(step1(GOOD_S1))).toEqual([]);
  });

  it("S1_TOO_LONG: over 25 words warns", () => {
    const long = `A ${"word ".repeat(24)}and more`;
    const codes = validateStep1(step1(long)).map((i) => i.code);
    expect(codes).toContain("S1_TOO_LONG");
  });

  it("S1_MULTI_SENTENCE: two sentences warn, quoted terminators do not", () => {
    const codes = validateStep1(step1("One thing happens. Then another thing follows")).map(
      (i) => i.code,
    );
    expect(codes).toContain("S1_MULTI_SENTENCE");

    const quoted = validateStep1(step1('She whispers "Run." before the map burns away'));
    expect(quoted.map((i) => i.code)).not.toContain("S1_MULTI_SENTENCE");
  });

  it("S1_HAS_NAMES: whole-word name match only", () => {
    const ctx: ValidateContext = { characterNames: ["Mina", "The Surveyor"] };
    expect(validateStep1(step1("Mina must find the harbour before dawn breaks"), ctx)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "S1_HAS_NAMES" })]),
    );
    // "Minaret" must not match "Mina".
    const noMatch = validateStep1(step1("A minaret keeper must guard the harbour gate"), ctx);
    expect(noMatch.map((i) => i.code)).not.toContain("S1_HAS_NAMES");
  });
});

describe("validateStep2", () => {
  it("S2_MISSING_PART: one error per empty part", () => {
    const issues = validateStep2(step2({ setup: "Only the setup is here." }));
    const missing = issues.filter((i) => i.code === "S2_MISSING_PART");
    expect(missing).toHaveLength(4);
    expect(missing.every((i) => i.severity === "error")).toBe(true);
  });

  it("a complete, calm paragraph yields no issues", () => {
    expect(validateStep2(GOOD_S2)).toEqual([]);
  });

  it("S2_NOT_ONE_SENTENCE: more than two terminators warns", () => {
    const issues = validateStep2(
      step2({ ...GOOD_S2, disaster2: "It rains. Then floods. Then the bridge falls. And more." }),
    );
    expect(issues.map((i) => i.code)).toContain("S2_NOT_ONE_SENTENCE");
  });

  it("S2_ENDING_UNRESOLVED: info only when setup and ending share no significant word", () => {
    const unresolved = validateStep2(
      step2({ ...GOOD_S2, ending: "Quietly, everything simply dissolves." }),
    );
    expect(unresolved.map((i) => i.code)).toContain("S2_ENDING_UNRESOLVED");

    const resolved = validateStep2(GOOD_S2); // setup and ending share "harbour"
    expect(resolved.map((i) => i.code)).not.toContain("S2_ENDING_UNRESOLVED");
  });
});

describe("validateStep dispatcher", () => {
  it("routes steps 1–2 and returns [] for later steps (validators arrive with their slices)", () => {
    expect(validateStep(1, step1(GOOD_S1))).toEqual([]);
    expect(validateStep(2, GOOD_S2)).toEqual([]);
    expect(validateStep(3, { majorCharacterIds: [], skipped: false })).toEqual([]);
  });

  it("blockingIssues keeps only errors", () => {
    const mixed = [...validateStep2(step2({ setup: "One. Two. Three. Four." }))];
    expect(blockingIssues(mixed).every((i) => i.severity === "error")).toBe(true);
  });
});

describe("issue catalogue coverage", () => {
  it("every emittable issue code has an English message", () => {
    const emitted = [
      ...validateStep1(step1(" ")),
      ...validateStep1(step1(`A ${"word ".repeat(24)}here. And a second sentence follows`)),
      ...validateStep2(step2({ setup: "One. Two. Three. Four." })),
      ...validateStep2(step2({ ...GOOD_S2, ending: "Quietly, everything simply dissolves." })),
      ...validateStep1(step1("Mina walks home"), { characterNames: ["Mina"] }),
    ];
    const catalogue = en.issues as Record<string, string>;
    for (const issue of emitted) {
      expect(catalogue[issue.code], `missing catalogue entry for ${issue.code}`).toBeTruthy();
    }
  });
});
