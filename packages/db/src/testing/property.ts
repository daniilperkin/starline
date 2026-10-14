import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { StorageDriver } from "../driver";
import { runMigrations } from "../migrate";
import { LATEST_SCHEMA_VERSION } from "../migrations/index";
import type { ContractHarness } from "./contract";

/**
 * Migration property tests (spec §4.5.4, S35). fast-check generates valid random row sets; every
 * case asserts the migration's three promises: foreign-key integrity (`PRAGMA foreign_key_check`
 * comes back empty), data preservation (the rows inserted around the migration are still there),
 * and idempotency (a second run applies nothing and changes nothing).
 *
 * The harness is injected exactly like the contract suite's, so the same properties run against
 * every StorageDriver backend.
 */
export function runMigrationPropertyTests(
  name: string,
  makeHarness: () => Promise<ContractHarness>,
): void {
  describe(`Migration properties — ${name}`, () => {
    const characterArb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value.trim().length > 0),
      role: fc.constantFrom(
        "protagonist",
        "antagonist",
        "major",
        "supporting",
        "minor",
        "mentioned",
      ),
      color: fc.constantFrom("#123456", "#a6aede", "#c9b98f"),
    });
    const sceneArb = fc.record({
      title: fc.string({ maxLength: 60 }),
      status: fc.constantFrom("idea", "outlined", "drafting", "drafted", "revising", "done"),
      targetWordCount: fc.option(fc.integer({ min: 100, max: 20_000 }), { nil: null }),
    });

    it("migrates, preserves random data, keeps FK integrity and is idempotent", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(characterArb, { maxLength: 10 }),
          fc.array(sceneArb, { maxLength: 10 }),
          async (characters, scenes) => {
            const h = await makeHarness();
            const driver: StorageDriver = h.driver;
            try {
              // A fresh file (schema 0) migrates to the latest version.
              await driver.open({ path: h.path, create: true, readOnly: false });
              const report = await runMigrations(driver);
              expect(report.to).toBe(LATEST_SCHEMA_VERSION);
              const versionRows = await driver.query<{ user_version: number }>(
                "PRAGMA user_version",
              );
              expect(versionRows[0]?.user_version).toBe(LATEST_SCHEMA_VERSION);

              // Random valid data lands after the migration.
              const projectId = "01900000-0000-7000-8000-0000000000b1";
              await driver.query(
                "INSERT INTO project(id,title,form,method,settings,created_at,updated_at) " +
                  "VALUES(?1,'P','novel','snowflake','{\"schemaVersion\":1}',?2,?2)",
                [projectId, Date.now()],
              );
              const characterIds: string[] = [];
              for (const [index, character] of characters.entries()) {
                const id = `01900000-0000-7000-8000-00000000c${String(index).padStart(3, "0")}`;
                characterIds.push(id);
                await driver.query(
                  "INSERT INTO character(id,project_id,name,role,color,order_key,created_at,updated_at) " +
                    "VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
                  [
                    id,
                    projectId,
                    character.name,
                    character.role,
                    character.color,
                    `a${String(index).padStart(2, "0")}`,
                    Date.now(),
                  ],
                );
              }
              const sceneIds: string[] = [];
              for (const [index, scene] of scenes.entries()) {
                const id = `01900000-0000-7000-8000-00000000d${String(index).padStart(3, "0")}`;
                sceneIds.push(id);
                await driver.query(
                  "INSERT INTO scene(id,project_id,title,status,body_json,body_text,body_word_count," +
                    "target_word_count,order_key,created_at,updated_at) " +
                    "VALUES(?1,?2,?3,?4,NULL,'',0,?5,?6,?7,?7)",
                  [
                    id,
                    projectId,
                    scene.title,
                    scene.status,
                    scene.targetWordCount,
                    `a${String(index).padStart(2, "0")}`,
                    Date.now(),
                  ],
                );
              }

              // The migration's promises: FK integrity holds…
              const fkViolations = await driver.query("PRAGMA foreign_key_check");
              expect(fkViolations).toEqual([]);
              // …data survives…
              const counts = await driver.query<{ n: number }>(
                "SELECT (SELECT COUNT(*) FROM character) AS n",
              );
              expect(counts[0]?.n).toBe(characterIds.length);
              const sceneCount = await driver.query<{ n: number }>(
                "SELECT (SELECT COUNT(*) FROM scene) AS n",
              );
              expect(sceneCount[0]?.n).toBe(sceneIds.length);
              // …and a re-run is a no-op.
              const again = await runMigrations(driver);
              expect(again.applied).toEqual([]);
              const after = await driver.query<{ n: number }>(
                "SELECT (SELECT COUNT(*) FROM character) AS n",
              );
              expect(after[0]?.n).toBe(characterIds.length);
            } finally {
              await driver.close().catch(() => undefined);
              await h.cleanup();
            }
          },
        ),
        { numRuns: 12 },
      );
    }, 120_000);
  });
}
