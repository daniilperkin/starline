import { describe, expect, it } from "vitest";
import type { SnowflakeStepNumber } from "../entities";
import type { UUID } from "../primitives";
import { computeStaleSteps } from "./staleness";
import type { SnowflakeStepContent, SnowflakeStepRow } from "./types";

function row(
  step: SnowflakeStepNumber,
  status: SnowflakeStepRow["status"],
  updatedAt: number,
): SnowflakeStepRow {
  return {
    id: `00000000-0000-7000-8000-00000000000${step}` as UUID,
    projectId: "00000000-0000-7000-8000-000000000001" as UUID,
    step,
    status,
    content: {} as SnowflakeStepContent,
    completedAt: status === "complete" ? updatedAt - 1 : null,
    overrides: [],
    updatedAt,
  };
}

describe("computeStaleSteps", () => {
  it("marks step 4 stale when step 2 was edited after completion", () => {
    const stale = computeStaleSteps([row(2, "complete", 200), row(4, "complete", 100)]);
    expect(stale.has(4)).toBe(true);
  });

  it("does not mark step 4 when step 2 is older", () => {
    const stale = computeStaleSteps([row(2, "complete", 50), row(4, "complete", 100)]);
    expect(stale.has(4)).toBe(false);
  });

  it("marks step 6 stale vs step 4, independently of step 2", () => {
    const stale = computeStaleSteps([
      row(2, "complete", 50),
      row(4, "complete", 200),
      row(6, "complete", 100),
    ]);
    expect(stale.has(4)).toBe(false);
    expect(stale.has(6)).toBe(true);
  });

  it("only badges complete steps", () => {
    const stale = computeStaleSteps([row(2, "complete", 200), row(4, "in_progress", 100)]);
    expect(stale.size).toBe(0);
  });

  it("tolerates missing rows", () => {
    expect(computeStaleSteps([row(4, "complete", 100)]).size).toBe(0);
  });
});
