import { countWords } from "../richtext";
import type { SnapshotCounts, SnapshotDiff } from "./types";

/**
 * Snapshot diffing (spec §4.5.3): what changed between a snapshot and the live project, in the
 * terms a writer thinks in — scenes, chapters, characters, lore, notes, plotlines, words. Both
 * sides are read through the same query interface, so this runs against the live database and
 * the snapshot connection alike (and against the native driver in tests).
 */

export interface SnapshotQueryRunner {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

async function countRows(runner: SnapshotQueryRunner, table: string): Promise<number> {
  const rows = await runner.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** Everything the Backups screen shows as "the project, then and now". */
export async function readSnapshotCounts(runner: SnapshotQueryRunner): Promise<SnapshotCounts> {
  const [scenes, chapters, characters, loreEntries, notes, plotlines, textRows] = await Promise.all(
    [
      countRows(runner, "scene"),
      countRows(runner, "chapter"),
      countRows(runner, "character"),
      countRows(runner, "lore_entry"),
      countRows(runner, "idea_note"),
      countRows(runner, "plotline"),
      runner.query<{ body_word_count: number; synopsis_text: string }>(
        "SELECT body_word_count, synopsis_text FROM scene WHERE deleted_at IS NULL",
      ),
    ],
  );
  let words = 0;
  for (const row of textRows) {
    words += Number(row.body_word_count ?? 0) + countWords(row.synopsis_text ?? "");
  }
  return { scenes, chapters, characters, loreEntries, notes, plotlines, words };
}

export async function computeSnapshotDiff(
  current: SnapshotQueryRunner,
  snapshot: SnapshotQueryRunner,
): Promise<SnapshotDiff> {
  const [currentCounts, snapshotCounts] = await Promise.all([
    readSnapshotCounts(current),
    readSnapshotCounts(snapshot),
  ]);
  const delta = {} as SnapshotCounts;
  for (const key of Object.keys(currentCounts) as Array<keyof SnapshotCounts>) {
    delta[key] = currentCounts[key] - snapshotCounts[key];
  }
  const identical = (Object.keys(delta) as Array<keyof SnapshotCounts>).every(
    (key) => delta[key] === 0,
  );
  return { current: currentCounts, snapshot: snapshotCounts, delta, identical };
}
