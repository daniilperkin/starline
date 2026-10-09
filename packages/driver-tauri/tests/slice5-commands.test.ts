import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChangeBus,
  type Command,
  copyLineToSceneSynopsis,
  createChapter,
  createCharacter,
  createPlotline,
  createProject,
  createScene,
  deleteChapter,
  deleteCharacter,
  deleteScene,
  emptyTrash,
  executeCommand,
  listScenes,
  listTrash,
  moveScene,
  purgeExpiredTrash,
  restoreEntity,
  setScenePlacement,
  type UUID,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 5 integration: the trash lifecycle, the undo inverses and the step-9 copy trigger,
 * exercised through the real native driver (rusqlite via the stdio CLI) against real SQL —
 * migrations, STRICT tables, FK cascades and all. Complements the pure-unit validator tests.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

let driver: TauriStorageDriver;
let transport: StdioTransport;
let dir: string;
let projectId: UUID;
const bus = new ChangeBus();

function ensureCliBuilt(): void {
  if (existsSync(binPath) && process.env.STARLINE_REBUILD_CLI !== "1") return;
  execFileSync("node", [join(repoRoot, "scripts", "cargo.mjs"), "build"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

async function run<A, R>(command: Command<A, R>, args: A): Promise<R> {
  return executeCommand({ transaction: (fn) => driver.transaction(fn) }, bus, command, args);
}

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice5-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (await run(createProject, { title: "Slice 5" })).projectId;
});

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  try {
    await transport.dispose();
  } catch {
    // child already gone
  }
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("trash lifecycle (spec §3.9 / §5.3)", () => {
  it("soft-deletes, lists, and restores a character", async () => {
    const { characterId } = await run(createCharacter, {
      projectId,
      name: "Mina Voss",
      role: "protagonist",
    });
    await run(deleteCharacter, { projectId, characterId });

    const listed = await listTrash(driver, projectId);
    const row = listed.find((item) => item.entityId === characterId);
    expect(row).toBeDefined();
    expect(row?.entityType).toBe("character");
    expect(row?.label).toBe("Mina Voss");

    const { restored } = await run(restoreEntity, {
      projectId,
      entityType: "character",
      entityId: characterId,
    });
    expect(restored).toBe(true);
    expect((await listTrash(driver, projectId)).some((i) => i.entityId === characterId)).toBe(
      false,
    );
    const live = await driver.query<{ deleted_at: number | null }>(
      "SELECT deleted_at FROM character WHERE id = ?",
      [characterId],
    );
    expect(live[0]?.deleted_at).toBeNull();
  });

  it("restoring an already-purged row reports restored: false", async () => {
    const { characterId } = await run(createCharacter, { projectId, name: "Ghost" });
    await run(deleteCharacter, { projectId, characterId });
    await run(emptyTrash, { projectId });
    const { restored } = await run(restoreEntity, {
      projectId,
      entityType: "character",
      entityId: characterId,
    });
    expect(restored).toBe(false);
  });

  it("purging keeps rows inside the retention window and removes older ones", async () => {
    const { sceneId } = await run(createScene, { projectId, title: "Old scene" });
    await run(deleteScene, { projectId, sceneId });
    const backdated = Date.now() - 31 * 86_400_000;
    await driver.transaction(async (tx) => {
      await tx.query("UPDATE scene SET deleted_at = ? WHERE id = ?", [backdated, sceneId]);
    });
    const result = await run(purgeExpiredTrash, { projectId });
    expect(result.purged).toBeGreaterThanOrEqual(1);
    const rows = await driver.query<{ n: number }>("SELECT COUNT(*) AS n FROM scene WHERE id = ?", [
      sceneId,
    ]);
    expect(rows[0]?.n).toBe(0);
  });

  it("empty trash removes every soft-deleted row regardless of age", async () => {
    const { plotlineId } = await run(createPlotline, { projectId, name: "Doomed arc" });
    await driver.transaction(async (tx) => {
      await tx.query("UPDATE plotline SET deleted_at = ? WHERE id = ?", [Date.now(), plotlineId]);
    });
    const result = await run(emptyTrash, { projectId });
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(await listTrash(driver, projectId)).toHaveLength(0);
  });
});

describe("undo inverses (spec §2.3.3)", () => {
  it("setScenePlacement restores a captured chapter + order key after a move", async () => {
    const { chapterId: chapterA } = await run(createChapter, { projectId, title: "A" });
    const { chapterId: chapterB } = await run(createChapter, { projectId, title: "B" });
    const { sceneId } = await run(createScene, { projectId, chapterId: chapterA, title: "Ferry" });
    const before = (await listScenes(driver, projectId)).find((scene) => scene.id === sceneId);
    expect(before?.chapterId).toBe(chapterA);

    await run(moveScene, { projectId, sceneId, chapterId: chapterB, beforeSceneId: null });
    const moved = (await listScenes(driver, projectId)).find((scene) => scene.id === sceneId);
    expect(moved?.chapterId).toBe(chapterB);

    await run(setScenePlacement, {
      projectId,
      sceneId,
      chapterId: before?.chapterId ?? null,
      orderKey: before?.orderKey ?? "",
    });
    const undone = (await listScenes(driver, projectId)).find((scene) => scene.id === sceneId);
    expect(undone?.chapterId).toBe(chapterA);
    expect(undone?.orderKey).toBe(before?.orderKey);
  });

  it("restoring a deleted chapter does not resurrect its scenes' chapter links", async () => {
    const { chapterId } = await run(createChapter, { projectId, title: "Temp" });
    const { sceneId } = await run(createScene, { projectId, chapterId, title: "In temp" });
    await run(deleteChapter, { projectId, chapterId });
    const unassigned = (await listScenes(driver, projectId)).find((scene) => scene.id === sceneId);
    expect(unassigned?.chapterId).toBeNull();

    await run(restoreEntity, { projectId, entityType: "chapter", entityId: chapterId });
    const restored = await driver.query<{ deleted_at: number | null }>(
      "SELECT deleted_at FROM chapter WHERE id = ?",
      [chapterId],
    );
    expect(restored[0]?.deleted_at).toBeNull();
  });
});

describe("step-9 copy trigger (spec §3.4.3)", () => {
  it("copies the step-8 line into the synopsis once, then reports alreadyPresent", async () => {
    const { sceneId } = await run(createScene, {
      projectId,
      title: "Ferry",
      source: {
        step: 8,
        line: 3,
        oneLine: "Mina boards the night ferry",
      },
    });
    const first = await run(copyLineToSceneSynopsis, { projectId, sceneId });
    expect(first.copied).toBe(true);
    expect(first.alreadyPresent).toBe(false);
    const synopsis = await driver.query<{ synopsis_text: string }>(
      "SELECT synopsis_text FROM scene WHERE id = ?",
      [sceneId],
    );
    expect(synopsis[0]?.synopsis_text).toContain("Mina boards the night ferry");

    const second = await run(copyLineToSceneSynopsis, { projectId, sceneId });
    expect(second.copied).toBe(false);
    expect(second.alreadyPresent).toBe(true);
  });

  it("falls back to the title for legacy rows that stored no one-liner text", async () => {
    // Pre-Slice-5 rows carry only `{ step: 8, line: <pasted line number> }` — a merge key
    // without text — and an empty synopsis, so the title is the only copyable string.
    const { sceneId } = await run(createScene, {
      projectId,
      title: "The bridge collapses",
      source: { step: 8, line: 7 },
    });
    const result = await run(copyLineToSceneSynopsis, { projectId, sceneId });
    expect(result.copied).toBe(true);
    const synopsis = await driver.query<{ synopsis_text: string }>(
      "SELECT synopsis_text FROM scene WHERE id = ?",
      [sceneId],
    );
    expect(synopsis[0]?.synopsis_text).toContain("The bridge collapses");
  });
});
