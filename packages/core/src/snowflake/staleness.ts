import type { SnowflakeStepNumber } from "../entities";
import type { SnowflakeStepRow, Step8Content } from "./types";

/**
 * Computed staleness badges (spec §3.4: never stored). A completed downstream step goes
 * stale when its upstream source was edited afterwards:
 *   step 4 ← step 2, step 6 ← step 4 (compared by row timestamps);
 *   step 8 ← step 6 (the scene list is stale when any step-6 section changed after the last
 *   scene extraction — `lastImportedAt`, with the step-8 row's own timestamp as fallback).
 */
const STALE_PAIRS: ReadonlyArray<readonly [SnowflakeStepNumber, SnowflakeStepNumber]> = [
  [4, 2],
  [6, 4],
];

export function computeStaleSteps(steps: readonly SnowflakeStepRow[]): Set<SnowflakeStepNumber> {
  const stale = new Set<SnowflakeStepNumber>();
  const byStep = new Map(steps.map((row) => [row.step, row]));
  for (const [downstream, upstream] of STALE_PAIRS) {
    const down = byStep.get(downstream);
    const up = byStep.get(upstream);
    if (!down || !up) continue;
    if (down.status === "complete" && up.updatedAt > down.updatedAt) stale.add(downstream);
  }
  const step8 = byStep.get(8);
  const step6 = byStep.get(6);
  if (step8 && step6 && step8.status === "complete") {
    const content = step8.content as Partial<Step8Content>;
    const extractedAt = content.lastImportedAt ?? step8.updatedAt;
    if (step6.updatedAt > extractedAt) stale.add(8);
  }
  return stale;
}
