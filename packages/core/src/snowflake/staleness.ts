import type { SnowflakeStepNumber } from "../entities";
import type { SnowflakeStepRow } from "./types";

/**
 * Computed staleness badges (spec §3.4: never stored). A completed downstream step goes
 * stale when its upstream source was edited afterwards:
 *   step 4 ← step 2, step 6 ← step 4 (step 8 ← step 6 arrives with the scene slices).
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
  return stale;
}
