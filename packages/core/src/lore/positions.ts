import type { UUID } from "../primitives";

const META_LORE_POSITIONS = "lore_positions";

/** The lore map's pins: entry id → canvas coordinates (the graph's pattern, slice 8). */
export type LorePositions = Record<string, { x: number; y: number }>;

export interface LorePositionRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback; // defensive: our own writes are always valid JSON
  }
}

/** Slice 31: where each lore entry sits on the map view; device-independent, travels in the file. */
export async function getLorePositions(
  runner: LorePositionRunner,
  projectId: UUID,
): Promise<LorePositions> {
  const rows = await runner.query<{ value: string }>("SELECT value FROM meta WHERE key = ?", [
    META_LORE_POSITIONS,
  ]);
  const all = parseJson<Record<string, LorePositions>>(rows[0]?.value ?? "", {});
  return all[projectId] ?? {};
}

export async function setLorePositions(
  runner: LorePositionRunner,
  projectId: UUID,
  positions: LorePositions,
): Promise<void> {
  const rows = await runner.query<{ value: string }>("SELECT value FROM meta WHERE key = ?", [
    META_LORE_POSITIONS,
  ]);
  const all = parseJson<Record<string, LorePositions>>(rows[0]?.value ?? "", {});
  all[projectId] = positions;
  await runner.query(
    `INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [META_LORE_POSITIONS, JSON.stringify(all)],
  );
}
