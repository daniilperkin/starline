import type { StorageDriver } from "./driver";
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from "./migrations/index";

export interface MigrationReport {
  from: number;
  to: number;
  applied: number[];
}

/**
 * Applies all pending migrations, each inside its own transaction (spec §4.5.4).
 * Opening a file created by a newer app version is refused; the UI turns this into the
 * read-only "created by a newer version" banner (spec §2.3.3).
 */
export async function runMigrations(driver: StorageDriver): Promise<MigrationReport> {
  const rows = await driver.query<{ user_version: number }>("PRAGMA user_version");
  const current = rows[0]?.user_version ?? 0;

  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `This file uses schema v${current}, newer than this build supports (v${LATEST_SCHEMA_VERSION}). ` +
        "Update StarLine to edit this file.",
    );
  }

  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await driver.transaction(async (tx) => {
      await tx.execScript(migration.sql);
    });
    applied.push(migration.version);
  }

  const to = applied.length > 0 ? (applied[applied.length - 1] as number) : current;
  return { from: current, to, applied };
}
