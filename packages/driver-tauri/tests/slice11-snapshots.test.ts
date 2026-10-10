import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChangeBus,
  type Command,
  computeSnapshotDiff,
  createCharacter,
  createLoreEntry,
  createProject,
  createScene,
  deleteCharacter,
  deleteScene,
  type ExtractedEntity,
  executeCommand,
  extractEntity,
  listRestorableEntities,
  listSnapshotRecords,
  planRetention,
  readRecordCounts,
  reconcileSnapshotRecords,
  recordSnapshot,
  restoreEntityFromSnapshot,
  richTextFromPlain,
  setSceneCharacters,
  type UUID,
  updateScene,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 11 integration on the real native driver: the restore drill the plan asks for (three
 * destructive changes, restore from the pre-change snapshot, counts verified), the snapshot
 * diff, single-entity restore, and the `snapshot_record` index staying honest when files
 * disappear behind the app's back.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

let dir: string;
let libraryPath: string;
let driver: TauriStorageDriver;
let projectId: UUID;
const bus = new ChangeBus();

function ensureCliBuilt(): void {
  if (existsSync(binPath) && process.env.STARLINE_REBUILD_CLI !== "1") return;
  execFileSync("node", [join(repoRoot, "scripts", "cargo.mjs"), "build"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

async function openDriver(
  path: string,
  readOnly = false,
): Promise<{
  driver: TauriStorageDriver;
  transport: StdioTransport;
}> {
  const transport = new StdioTransport({
    command: binPath,
    env: { STARLINE_LOCK_STALE_MS: "500" },
  });
  const instance = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await instance.open({ path, create: false, readOnly });
  return { driver: instance, transport };
}

async function run<A, R>(target: TauriStorageDriver, command: Command<A, R>, args: A): Promise<R> {
  return executeCommand({ transaction: (fn) => target.transaction(fn) }, bus, command, args);
}

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice11-"));
  libraryPath = join(dir, "library.starline");
  const opened = await openDriver(libraryPath, true).catch(async () => {
    // The file does not exist yet: create it through a writable open.
    const transport = new StdioTransport({
      command: binPath,
      env: { STARLINE_LOCK_STALE_MS: "500" },
    });
    const instance = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
    await instance.open({ path: libraryPath, create: true, readOnly: false });
    return { driver: instance, transport };
  });
  driver = opened.driver;
  await runMigrations(driver);
  projectId = (await run(driver, createProject, { title: "Slice 11" })).projectId;

  const mina = (
    await run(driver, createCharacter, { projectId, name: "Mina Voss", role: "protagonist" })
  ).characterId;
  const tor = (await run(driver, createCharacter, { projectId, name: "Tor Halden", role: "major" }))
    .characterId;
  await run(driver, createLoreEntry, { projectId, name: "Harbour", kind: "location" });
  const sceneA = (await run(driver, createScene, { projectId, title: "The ferry" })).sceneId;
  const sceneB = (await run(driver, createScene, { projectId, title: "The ridge road" })).sceneId;
  await run(driver, setSceneCharacters, { projectId, sceneId: sceneA, characterIds: [mina, tor] });
  await run(driver, setSceneCharacters, { projectId, sceneId: sceneB, characterIds: [mina] });
  await run(driver, updateScene, {
    projectId,
    sceneId: sceneA,
    patch: { synopsis: richTextFromPlain("Mina takes the ferry across a cold harbour.") },
  });
});

afterAll(async () => {
  await driver?.close().catch(() => undefined);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("snapshot diff", () => {
  it("reads the same project through two connections and reports the delta", async () => {
    const snapshotPath = join(dir, "snap-diff.starline");
    await driver.snapshot(snapshotPath);
    const second = await openDriver(snapshotPath, true);
    try {
      const diff = await computeSnapshotDiff(driver, second.driver);
      expect(diff.identical).toBe(true);
      expect(diff.delta.scenes).toBe(0);
      expect(diff.current.scenes).toBe(2);
      expect(diff.current.characters).toBe(2);
      expect(diff.current.words).toBeGreaterThan(0);

      // Change the live project: the diff must move, the snapshot must not.
      await run(driver, createScene, { projectId, title: "A third scene" });
      const after = await computeSnapshotDiff(driver, second.driver);
      expect(after.delta.scenes).toBe(1);
      expect(after.snapshot.scenes).toBe(2);
      expect(after.identical).toBe(false);
      await run(driver, deleteScene, {
        projectId,
        sceneId: (
          await driver.query<{ id: string }>("SELECT id FROM scene WHERE title = 'A third scene'")
        )[0]?.id as UUID,
      });
    } finally {
      await second.driver.close();
      await second.transport.dispose().catch(() => undefined);
    }
  });
});

describe("restore drill (the slice's exit criterion)", () => {
  it("restores a pre-change snapshot after three destructive changes", async () => {
    const before = await driver.query<{ scenes: number; characters: number }>(
      `SELECT (SELECT COUNT(*) FROM scene WHERE deleted_at IS NULL) AS scenes,
              (SELECT COUNT(*) FROM character WHERE deleted_at IS NULL) AS characters`,
    );
    const sceneIds = await driver.query<{ id: string }>(
      "SELECT id FROM scene WHERE deleted_at IS NULL ORDER BY order_key",
    );
    const characterIds = await driver.query<{ id: string }>(
      "SELECT id FROM character WHERE deleted_at IS NULL ORDER BY name",
    );

    // Snapshot the good state, then make three destructive changes.
    const snapshotPath = join(dir, "pre-change.starline");
    await driver.snapshot(snapshotPath);
    expect(statSync(snapshotPath).size).toBeGreaterThan(0);

    await run(driver, deleteScene, { projectId, sceneId: sceneIds[0]?.id as UUID });
    await run(driver, deleteScene, { projectId, sceneId: sceneIds[1]?.id as UUID });
    await run(driver, deleteCharacter, { projectId, characterId: characterIds[1]?.id as UUID });
    const damaged = await driver.query<{ scenes: number; characters: number }>(
      `SELECT (SELECT COUNT(*) FROM scene WHERE deleted_at IS NULL) AS scenes,
              (SELECT COUNT(*) FROM character WHERE deleted_at IS NULL) AS characters`,
    );
    expect(damaged[0]?.scenes).toBe(Number(before[0]?.scenes) - 2);
    expect(damaged[0]?.characters).toBe(Number(before[0]?.characters) - 1);

    // Restore = replace the library file with the snapshot (the native equivalent of the web
    // store's import_file path), then reopen.
    await driver.close();
    copyFileSync(snapshotPath, libraryPath);
    const reopened = await openDriver(libraryPath, false);
    driver = reopened.driver;
    const restored = await driver.query<{ scenes: number; characters: number }>(
      `SELECT (SELECT COUNT(*) FROM scene WHERE deleted_at IS NULL) AS scenes,
              (SELECT COUNT(*) FROM character WHERE deleted_at IS NULL) AS characters`,
    );
    expect(restored[0]?.scenes).toBe(before[0]?.scenes);
    expect(restored[0]?.characters).toBe(before[0]?.characters);
    const integrity = await driver.integrityCheck();
    expect(integrity.ok).toBe(true);
  });
});

describe("restore single entity", () => {
  it("copies one scene back out of a snapshot into the live project", async () => {
    const snapshotPath = join(dir, "snap-entity.starline");
    await driver.snapshot(snapshotPath);
    const scenes = await driver.query<{ id: string; title: string }>(
      "SELECT id, title FROM scene WHERE deleted_at IS NULL ORDER BY order_key",
    );
    const victim = scenes[0];
    expect(victim).toBeDefined();
    await run(driver, deleteScene, { projectId, sceneId: victim?.id as UUID });
    const gone = await driver.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM scene WHERE deleted_at IS NULL",
    );
    expect(gone[0]?.n).toBe(scenes.length - 1);

    const second = await openDriver(snapshotPath, true);
    try {
      const entities = await listRestorableEntities(second.driver);
      expect(entities.some((entity) => entity.id === victim?.id)).toBe(true);

      const extracted: ExtractedEntity = await extractEntity(
        second.driver,
        "scene",
        victim?.id as UUID,
      );
      expect(extracted.tables[0]?.table).toBe("scene");
      expect(extracted.tables.some((table) => table.table === "scene_character")).toBe(true);

      const result = await driver.transaction((tx) => restoreEntityFromSnapshot(tx, extracted));
      expect(result.restored).toBeGreaterThan(1);
      expect(result.skipped).toBe(0);

      const back = await driver.query<{ title: string; deleted_at: number | null }>(
        "SELECT title, deleted_at FROM scene WHERE id = ?",
        [victim?.id as UUID],
      );
      expect(back[0]?.title).toBe(victim?.title);
      // The row is revived, not duplicated: the soft-delete marker is gone.
      expect(back[0]?.deleted_at).toBeNull();
      const total = await driver.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM scene WHERE deleted_at IS NULL",
      );
      expect(total[0]?.n).toBe(scenes.length);
      // The cast row came back with it.
      const cast = await driver.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM scene_character WHERE scene_id = ?",
        [victim?.id as UUID],
      );
      expect(cast[0]?.n).toBeGreaterThan(0);
    } finally {
      await second.driver.close();
      await second.transport.dispose().catch(() => undefined);
    }
  });
});

describe("snapshot_record index", () => {
  it("records a snapshot with its counts and reconciles against the files on disk", async () => {
    const counts = await readRecordCounts(driver);
    expect(counts.sceneCount).toBeGreaterThan(0);
    expect(counts.schemaVersion).toBeGreaterThan(0);

    await recordSnapshot(driver, {
      fileName: "Library-20261010-000000-manual.starline",
      createdAt: Date.now(),
      reason: "manual",
      byteSize: 1234,
      schemaVersion: counts.schemaVersion,
      wordCount: counts.wordCount,
      sceneCount: counts.sceneCount,
      label: "test",
    });
    await recordSnapshot(driver, {
      fileName: "Library-20261009-000000-open.starline",
      createdAt: Date.now() - 86400000,
      reason: "open",
      byteSize: 100,
      schemaVersion: counts.schemaVersion,
      wordCount: 0,
      sceneCount: 0,
    });
    let records = await listSnapshotRecords(driver);
    expect(records.length).toBe(2);
    expect(records[0]?.label).toBe("test");

    // The open snapshot's file is gone; a file nobody indexed appeared.
    const result = await reconcileSnapshotRecords(driver, [
      {
        name: "Library-20261010-000000-manual.starline",
        createdAt: Date.now(),
        byteSize: 1234,
        reason: "manual",
      },
      {
        name: "Library-20261010-120000-activity.starline",
        createdAt: Date.now(),
        byteSize: 99,
        reason: "activity",
      },
    ]);
    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    records = await listSnapshotRecords(driver);
    expect(records.map((record) => record.fileName).sort()).toEqual([
      "Library-20261010-000000-manual.starline",
      "Library-20261010-120000-activity.starline",
    ]);
    // Idempotent: a second reconcile changes nothing.
    const again = await reconcileSnapshotRecords(driver, [
      {
        name: "Library-20261010-000000-manual.starline",
        createdAt: Date.now(),
        byteSize: 1234,
        reason: "manual",
      },
      {
        name: "Library-20261010-120000-activity.starline",
        createdAt: Date.now(),
        byteSize: 99,
        reason: "activity",
      },
    ]);
    expect(again).toEqual({ added: 0, removed: 0 });
    await driver.query("DELETE FROM snapshot_record");
  });
});

describe("retention", () => {
  it("keeps the newest file whatever else the policy says", () => {
    const now = Date.now();
    const plan = planRetention(
      [
        { name: "newest", createdAt: now, byteSize: 10, reason: "activity", label: "" },
        {
          name: "old",
          createdAt: now - 400 * 86400000,
          byteSize: 10,
          reason: "activity",
          label: "",
        },
        {
          name: "manual",
          createdAt: now - 400 * 86400000,
          byteSize: 10,
          reason: "manual",
          label: "",
        },
      ],
      now,
    );
    expect(plan.remove).toEqual(["old"]);
    expect(plan.keep).toContain("newest");
    expect(plan.keep).toContain("manual");
  });
});
