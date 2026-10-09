import { ChangeBus, executeCommand, listProjects, purgeExpiredTrash } from "@starline/core";
import type { StorageDriver } from "@starline/db";

/**
 * Session health (spec §2.3.3 / §5.3): crash-recovery detection via open/clean markers in the
 * `meta` table, the on-open integrity check, and the 30-day trash purge. Markers are written
 * through the storage driver's transaction API so they live inside the library file itself —
 * a stale marker can only mean the previous session never closed the file cleanly.
 */
export interface SessionHealth {
  integrityOk: boolean;
  integrityMessages: string[];
  crashed: boolean;
  lastChangeAt: number | null;
}

const SESSION_OPEN_KEY = "session_open_at";
const SESSION_CLEAN_KEY = "session_clean";

async function readMeta(driver: StorageDriver, key: string): Promise<string | null> {
  const rows = await driver.query<{ value: string }>("SELECT value FROM meta WHERE key = ?", [key]);
  return rows[0]?.value ?? null;
}

async function writeMeta(driver: StorageDriver, key: string, value: string): Promise<void> {
  await driver.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  });
}

/**
 * Reads the markers the previous session left behind, runs the integrity check, and returns
 * what the UI needs to decide on a banner. Call BEFORE `markSessionOpen`.
 */
export async function assessSessionHealth(driver: StorageDriver): Promise<SessionHealth> {
  const [prevOpen, prevClean] = await Promise.all([
    readMeta(driver, SESSION_OPEN_KEY),
    readMeta(driver, SESSION_CLEAN_KEY),
  ]);
  const integrity = await driver
    .integrityCheck()
    .catch(() => ({ ok: true, messages: [] as string[] }));
  const crashed = prevOpen !== null && prevClean !== "1";
  let lastChangeAt: number | null = null;
  if (crashed) {
    const rows = await driver.query<{ m: number | null }>(
      `SELECT MAX(m) AS m FROM (
         SELECT MAX(updated_at) AS m FROM snowflake_step
         UNION ALL SELECT MAX(updated_at) FROM character
         UNION ALL SELECT MAX(updated_at) FROM scene
         UNION ALL SELECT MAX(updated_at) FROM chapter
       )`,
    );
    lastChangeAt = rows[0]?.m ?? null;
  }
  return {
    integrityOk: integrity.ok,
    integrityMessages: integrity.messages,
    crashed,
    lastChangeAt,
  };
}

/** Marks the file as open by this session (crash marker; cleared by `markSessionClean`). */
export async function markSessionOpen(driver: StorageDriver): Promise<void> {
  await writeMeta(driver, SESSION_OPEN_KEY, String(Date.now()));
  await writeMeta(driver, SESSION_CLEAN_KEY, "0");
}

/** Marks the file as cleanly closed; a crash leaves the flag at "0". */
export async function markSessionClean(driver: StorageDriver): Promise<void> {
  await writeMeta(driver, SESSION_CLEAN_KEY, "1");
}

/**
 * Spec §5.3: soft-deleted rows are purged 30 days after deletion. Runs on library open for
 * every book in the file; failures never block opening.
 */
export async function purgeTrashOnOpen(driver: StorageDriver): Promise<number> {
  try {
    const projects = await listProjects(driver);
    let purged = 0;
    for (const project of projects) {
      const bus = new ChangeBus();
      const result = await executeCommand(
        { transaction: (fn) => driver.transaction(fn) },
        bus,
        purgeExpiredTrash,
        { projectId: project.id },
      );
      purged += result.purged;
    }
    return purged;
  } catch {
    return 0;
  }
}
