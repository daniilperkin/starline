import type { SnowflakeStepNumber } from "../entities";
import { EMPTY_RICH_TEXT, makeRichText, type PMDoc } from "../richtext";
import type {
  SnowflakeStepContent,
  Step1Content,
  Step2Content,
  Step3Content,
  Step4Content,
  Step5Content,
  Step6Content,
  Step7Content,
  Step8Content,
  Step9Content,
} from "./types";
import { EXPANSION_KEYS, STEP2_PARTS } from "./types";

/** Fresh empty content for a step — used when a project is created (all nine rows exist from day one). */
export function emptyStepContent(step: SnowflakeStepNumber): SnowflakeStepContent {
  switch (step) {
    case 1:
      return { sentence: "", alternatives: [] } satisfies Step1Content;
    case 2:
      return {
        setup: "",
        disaster1: "",
        disaster2: "",
        disaster3: "",
        ending: "",
      } satisfies Step2Content;
    case 3:
      return { majorCharacterIds: [], skipped: false } satisfies Step3Content;
    case 4:
      return {
        paragraphs: EXPANSION_KEYS.map((sourceKey) => ({
          sourceKey,
          text: { ...EMPTY_RICH_TEXT },
        })),
      } satisfies Step4Content;
    case 5:
      return { reviewedCharacterIds: [] } satisfies Step5Content;
    case 6:
      return { sections: [] } satisfies Step6Content;
    case 7:
      return { completedCharacterIds: [] } satisfies Step7Content;
    case 8:
      return { generatedSceneIds: [], lastImportedAt: null } satisfies Step8Content;
    case 9:
      return { expandedSceneIds: [], skipped: false } satisfies Step9Content;
    default: {
      const exhaustive: never = step;
      throw new Error(`unsupported snowflake step: ${String(exhaustive)}`);
    }
  }
}

/**
 * "Break step 2 into step 4 paragraphs" (spec §3.4.3): five paragraphs, each pre-seeded with
 * its step-2 sentence as the first line.
 */
export function seedStep4FromStep2(step2: Step2Content): Step4Content {
  return {
    paragraphs: EXPANSION_KEYS.map((sourceKey) => {
      const line = step2[sourceKey].trim();
      const doc: PMDoc = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: line.length > 0 ? [{ type: "text", text: line }] : [],
          },
        ],
      };
      return { sourceKey, text: makeRichText(doc) };
    }),
  };
}

/** True when the user cleared all meaningful content (drives the not_started demotion, spec §3.4.1). */
export function isStepContentEmpty(
  step: SnowflakeStepNumber,
  content: SnowflakeStepContent,
): boolean {
  switch (step) {
    case 1: {
      const c = content as Step1Content;
      return c.sentence.trim() === "" && c.alternatives.length === 0;
    }
    case 2: {
      const c = content as Step2Content;
      return STEP2_PARTS.every((part) => c[part].trim() === "");
    }
    case 3: {
      const c = content as Step3Content;
      return c.majorCharacterIds.length === 0 && !c.skipped;
    }
    case 4: {
      const c = content as Step4Content;
      return c.paragraphs.every((paragraph) => paragraph.text.text.trim() === "");
    }
    case 5: {
      const c = content as Step5Content;
      return c.reviewedCharacterIds.length === 0;
    }
    case 6: {
      const c = content as Step6Content;
      return c.sections.every((section) => section.text.text.trim() === "");
    }
    case 7: {
      const c = content as Step7Content;
      return c.completedCharacterIds.length === 0;
    }
    case 8: {
      const c = content as Step8Content;
      return c.generatedSceneIds.length === 0;
    }
    case 9: {
      const c = content as Step9Content;
      return c.expandedSceneIds.length === 0 && !c.skipped;
    }
    default: {
      const exhaustive: never = step;
      throw new Error(`unsupported snowflake step: ${String(exhaustive)}`);
    }
  }
}
