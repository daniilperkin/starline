import { describe, expect, it } from "vitest";
import { seedStep4FromStep2 } from "./defaults";
import { EXPANSION_KEYS, type Step2Content } from "./types";

const STEP2: Step2Content = {
  setup: "A quiet harbour town thrives on the trade winds.",
  disaster1: "The winds vanish and the fleet is stranded.",
  disaster2: "A rival fleet arrives to claim the harbour.",
  disaster3: "The harbour burns and the townsfolk scatter.",
  ending: "The harbour is rebuilt from the ruins of the fleet.",
};

describe("seedStep4FromStep2", () => {
  it("seeds all five paragraphs with their step-2 sentence as the first line", () => {
    const step4 = seedStep4FromStep2(STEP2);
    expect(step4.paragraphs.map((paragraph) => paragraph.sourceKey)).toEqual([...EXPANSION_KEYS]);
    for (const paragraph of step4.paragraphs) {
      expect(paragraph.text.text).toBe(STEP2[paragraph.sourceKey]);
      expect(paragraph.text.wordCount).toBeGreaterThan(0);
      expect(paragraph.text.json?.type).toBe("doc");
    }
  });

  it("keeps empty sentences as empty paragraphs (no fabricated text)", () => {
    const step4 = seedStep4FromStep2({ ...STEP2, disaster2: "  " });
    const disaster2 = step4.paragraphs.find((paragraph) => paragraph.sourceKey === "disaster2");
    expect(disaster2?.text.text).toBe("");
  });
});
