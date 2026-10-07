import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageDriver } from "../driver";
import { runMigrations } from "../migrate";
import { LATEST_SCHEMA_VERSION } from "../migrations/index";

/** Everything a driver implementation must provide for the shared contract suite. */
export interface ContractHarness {
  /** Primary driver instance, not yet opened. */
  driver: StorageDriver;
  /** File path (native) or OPFS name (web) of the project file. */
  path: string;
  /** Fresh destination for the snapshot test. */
  snapshotPath: string;
  /** Additional driver instances on the same storage backend. */
  newDriver(): Promise<StorageDriver>;
  /** Simulate an external modification of the project file (mtime bump). */
  touchFile?(): Promise<void>;
  cleanup(): Promise<void>;
}

const PROJECT_A = "01900000-0000-7000-8000-0000000000a1";
const PROJECT_B = "01900000-0000-7000-8000-0000000000a2";

const ALL_TABLES = [
  "series",
  "project",
  "snowflake_step",
  "character",
  "relationship_group",
  "character_relationship",
  "part",
  "chapter",
  "scene",
  "plotline",
  "scene_character",
  "scene_lore",
  "scene_plotline",
  "lore_category",
  "lore_entry",
  "entity_link",
  "idea_note",
  "tag",
  "entity_tag",
  "mention",
  "timeline_event",
  "attachment",
  "attachment_blob",
  "character_gallery",
  "custom_field_def",
  "custom_field_value",
  "meta",
  "snapshot_record",
  "search_fts",
  "search_trigram",
];

async function openMigrated(h: ContractHarness): Promise<StorageDriver> {
  await h.driver.open({ path: h.path, create: true, readOnly: false });
  await runMigrations(h.driver);
  return h.driver;
}

async function insertProject(driver: StorageDriver, id: string, title = "T"): Promise<void> {
  await driver.query(
    "INSERT INTO project(id,title,form,method,settings,created_at,updated_at) " +
      "VALUES(?1,?2,'novel','snowflake','{\"schemaVersion\":1}',?3,?3)",
    [id, title, Date.now()],
  );
}

async function countProjects(driver: StorageDriver): Promise<number> {
  const rows = await driver.query<{ n: number }>("SELECT COUNT(*) AS n FROM project");
  return rows[0]?.n ?? -1;
}

/**
 * The same suite runs against every StorageDriver implementation (spec §2.3.2): native
 * (rusqlite via stdio/tauri) and sqlite-wasm (OPFS). Behaviour differences are expressed
 * through `capabilities`, never by forking the suite.
 */
export function runStorageDriverContract(
  name: string,
  capabilities: { locking: boolean; externalChange: boolean; multiInstance: boolean },
  setup: () => Promise<ContractHarness>,
): void {
  describe(`StorageDriver contract — ${name}`, () => {
    let h: ContractHarness;

    beforeEach(async () => {
      h = await setup();
    });

    afterEach(async () => {
      await h.cleanup();
    });

    it("creates a new file, stamps application_id, reports pre-migration version", async () => {
      const info = await h.driver.open({ path: h.path, create: true, readOnly: false });
      expect(info.applicationId).toBe(0x5354524c);
      expect(info.schemaVersion).toBe(0);
      expect(info.lockedByOther).toBe(false);
    });

    it("refuses to open a missing file without create", async () => {
      await expect(
        h.driver.open({ path: h.path, create: false, readOnly: false }),
      ).rejects.toThrow();
    });

    it("applies migration 0001 and is idempotent on re-run", async () => {
      await openMigrated(h);
      const rows = await h.driver.query<{ user_version: number }>("PRAGMA user_version");
      expect(rows[0]?.user_version).toBe(LATEST_SCHEMA_VERSION);
      const again = await runMigrations(h.driver);
      expect(again.applied).toEqual([]);
    });

    it("created the full schema", async () => {
      await openMigrated(h);
      const rows = await h.driver.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      );
      const names = new Set(rows.map((row) => row.name));
      for (const table of ALL_TABLES) {
        expect(names.has(table), `missing table ${table}`).toBe(true);
      }
    });

    it("enforces foreign keys", async () => {
      await openMigrated(h);
      await expect(
        h.driver.query(
          "INSERT INTO character(id,project_id,name,color,order_key,created_at,updated_at) " +
            "VALUES('x','missing','X','#000000','a0',1,1)",
        ),
      ).rejects.toThrow();
    });

    it("enforces STRICT column types", async () => {
      await openMigrated(h);
      // SQLite converts lossless INTEGER -> TEXT in STRICT tables; the enforced direction is
      // text into a numeric column.
      await expect(
        h.driver.query(
          "INSERT INTO custom_field_def(id,project_id,target,label,type,order_key,created_at,updated_at,required) " +
            "VALUES('strict-test',?1,'character','S','text','a0',1,1,'not-an-int')",
          ["01900000-0000-7000-8000-0000000000f1"],
        ),
      ).rejects.toThrow();
    });

    it("round-trips parameter values incl. blobs", async () => {
      await openMigrated(h);
      const rows = await h.driver.query<{ s: string; n: number; z: null; b: Uint8Array }>(
        "SELECT ?1 AS s, ?2 AS n, ?3 AS z, ?4 AS b",
        ["hello", 42.5, null, new Uint8Array([1, 2, 3, 255])],
      );
      expect(rows[0]?.s).toBe("hello");
      expect(rows[0]?.n).toBe(42.5);
      expect(rows[0]?.z).toBeNull();
      expect(Array.from(rows[0]?.b ?? [])).toEqual([1, 2, 3, 255]);
    });

    it("commits transactions atomically", async () => {
      await openMigrated(h);
      await h.driver.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO project(id,title,form,method,settings,created_at,updated_at) " +
            "VALUES(?1,'A','novel','snowflake','{\"schemaVersion\":1}',?2,?2)",
          [PROJECT_A, Date.now()],
        );
      });
      expect(await countProjects(h.driver)).toBe(1);
    });

    it("rolls back failed transactions and stays usable", async () => {
      await openMigrated(h);
      await expect(
        h.driver.transaction(async (tx) => {
          await tx.query(
            "INSERT INTO project(id,title,form,method,settings,created_at,updated_at) " +
              "VALUES(?1,'B','novel','snowflake','{\"schemaVersion\":1}',?2,?2)",
            [PROJECT_B, Date.now()],
          );
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await countProjects(h.driver)).toBe(0);
      await insertProject(h.driver, PROJECT_A);
      expect(await countProjects(h.driver)).toBe(1);
    });

    it("persists data across close and reopen", async () => {
      await openMigrated(h);
      await insertProject(h.driver, PROJECT_A, "Persist me");
      await h.driver.close();
      // The OPFS sahpool VFS cannot share a file across pool instances (one worker owns its
      // files), so single-instance backends reopen on the same driver instead.
      const second = capabilities.multiInstance ? await h.newDriver() : h.driver;
      const info = await second.open({ path: h.path, create: false, readOnly: false });
      expect(info.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await countProjects(second)).toBe(1);
      await second.close();
    });

    it("takes a snapshot that opens read-only", async () => {
      await openMigrated(h);
      await insertProject(h.driver, PROJECT_A, "Snapshot me");
      const snap = await h.driver.snapshot(h.snapshotPath);
      expect(snap.byteSize).toBeGreaterThan(0);
      const reader = capabilities.multiInstance ? await h.newDriver() : h.driver;
      if (reader === h.driver) await h.driver.close();
      await reader.open({ path: h.snapshotPath, create: false, readOnly: true });
      const integrity = await reader.integrityCheck();
      expect(integrity.ok).toBe(true);
      expect(await countProjects(reader)).toBe(1);
      await reader.close();
    });

    it("integrity check passes on a healthy file", async () => {
      await openMigrated(h);
      const integrity = await h.driver.integrityCheck();
      expect(integrity.ok).toBe(true);
    });

    if (capabilities.locking) {
      it("reports lockedByOther for a second writer", async () => {
        await openMigrated(h);
        const second = await h.newDriver();
        const info = await second.open({ path: h.path, create: false, readOnly: false });
        expect(info.lockedByOther).toBe(true);
        await second.close();
      });
    }

    if (capabilities.externalChange) {
      it("fires onExternalChange when the file changes externally", async () => {
        await openMigrated(h);
        let fired = false;
        const unsubscribe = h.driver.onExternalChange(() => {
          fired = true;
        });
        // Give the watcher time to establish its baseline mtime.
        await new Promise((resolve) => setTimeout(resolve, 600));
        await h.touchFile?.();
        await vi.waitFor(() => expect(fired).toBe(true), { timeout: 5000 });
        unsubscribe();
      });
    }
  });
}
