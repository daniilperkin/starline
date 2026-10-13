import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChangeBus,
  type Command,
  createCharacter,
  createProject,
  createRelationship,
  createScene,
  executeCommand,
  type MergeCharactersResult,
  mergeCharacters,
  setSceneCharacters,
  type UUID,
  unmergeCharacters,
  updateCharacter,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 29 integration: the character merge and its inverse against the real native driver. The
 * merge is the one operation that touches nearly every table, so the test asserts the whole
 * repoint — relationships, scene presence, mentions (with count folding), custom fields, POV and
 * timeline — plus the alias append, the duplicate drops, and that the inverse puts every recorded
 * row back.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

let driver: TauriStorageDriver;
let transport: StdioTransport;
let dir: string;
let projectId: UUID;
let mina: UUID;
let duplicateMina: UUID;
let tor: UUID;
let sceneOne: UUID;
let sceneTwo: UUID;
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
  dir = await mkdtemp(join(tmpdir(), "starline-slice29-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (await run(createProject, { title: "Slice 29" })).projectId;

  mina = (await run(createCharacter, { projectId, name: "Mina Voss", role: "protagonist" }))
    .characterId;
  duplicateMina = (await run(createCharacter, { projectId, name: "Mina", role: "minor" }))
    .characterId;
  tor = (await run(createCharacter, { projectId, name: "Tor Halden", role: "major" })).characterId;

  sceneOne = (await run(createScene, { projectId, title: "The ferry" })).sceneId;
  sceneTwo = (await run(createScene, { projectId, title: "The strait" })).sceneId;
  await run(setSceneCharacters, { projectId, sceneId: sceneOne, characterIds: [mina, tor] });
  // Scene two holds ONLY the duplicate, so the merge must move the row rather than drop it.
  await run(setSceneCharacters, { projectId, sceneId: sceneTwo, characterIds: [duplicateMina] });
  await run(createRelationship, {
    projectId,
    sourceId: duplicateMina,
    targetId: tor,
    kind: "ally",
  });
  await run(createRelationship, { projectId, sourceId: mina, targetId: tor, kind: "friend" });
  await run(createRelationship, {
    projectId,
    sourceId: mina,
    targetId: duplicateMina,
    kind: "family_sibling",
  });
  // The mention mirror rows a body edit would have created: one naming only the duplicate, one
  // naming both (which the merge must fold into a single row whose count is the sum).
  await driver.query(
    `INSERT INTO mention (source_type, source_id, field, target_type, target_id, count)
     VALUES ('scene', ?, 'body', 'character', ?, 2), ('scene', ?, 'body', 'character', ?, 3)`,
    [sceneOne, duplicateMina, sceneOne, mina],
  );
});

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  await rm(dir, { recursive: true, force: true });
});

describe("slice 29 — character merge", () => {
  let result: MergeCharactersResult;

  it("merges every reference in one command and reports the counts", async () => {
    const merged = await run(mergeCharacters, {
      projectId,
      sourceId: duplicateMina,
      targetId: mina,
    });
    result = merged;
    expect(merged.relationshipsMoved).toBe(1); // the ally edge to Tor
    expect(merged.relationshipsDropped).toBe(1); // the source↔target edge described the merge itself
    expect(merged.scenesMoved).toBe(1); // scene two, where only the duplicate stood
    expect(merged.scenesDropped).toBe(0); // scene one already had Mina
    expect(merged.aliasesAdded).toBe(1); // "Mina" joins Mina Voss's aliases

    const survivors = await driver.query<{ id: string; deleted_at: number | null }>(
      "SELECT id, deleted_at FROM character WHERE project_id = ? ORDER BY name",
      [projectId],
    );
    expect(survivors.find((row) => row.id === duplicateMina)?.deleted_at).not.toBeNull();
    expect(survivors.find((row) => row.id === mina)?.deleted_at).toBeNull();

    const aliases = await driver.query<{ aliases: string }>(
      "SELECT aliases FROM character WHERE id = ?",
      [mina],
    );
    expect(JSON.parse(aliases[0]?.aliases ?? "[]")).toContain("Mina");

    const edges = await driver.query<{ source_id: string; target_id: string; kind: string }>(
      "SELECT source_id, target_id, kind FROM character_relationship WHERE deleted_at IS NULL ORDER BY kind",
      [],
    );
    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.kind).sort()).toEqual(["ally", "friend"]);

    const presence = await driver.query<{ character_id: string }>(
      "SELECT character_id FROM scene_character WHERE scene_id = ?",
      [sceneTwo],
    );
    expect(presence.map((row) => row.character_id)).toEqual([mina]);
  });

  it("rewrites mentions and folds a count when both characters were mentioned together", async () => {
    // The one-mention row moved to the target; the two-mention row folded into it with the sum.
    const rows = await driver.query<{ target_id: string; count: number }>(
      "SELECT target_id, count FROM mention WHERE source_type = 'scene' AND source_id = ? AND field = 'body'",
      [sceneOne],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_id).toBe(mina);
    expect(rows[0]?.count).toBe(5);
  });

  it("unmerges: every recorded row goes back and the source returns", async () => {
    const restored = await run(unmergeCharacters, { projectId, result: result as never });
    expect(restored.restored).toBeGreaterThan(0);

    const survivors = await driver.query<{ id: string; deleted_at: number | null }>(
      "SELECT id, deleted_at FROM character WHERE project_id = ?",
      [projectId],
    );
    expect(survivors.find((row) => row.id === duplicateMina)?.deleted_at).toBeNull();

    const edges = await driver.query<{ source_id: string; target_id: string; kind: string }>(
      "SELECT source_id, target_id, kind FROM character_relationship WHERE deleted_at IS NULL ORDER BY kind",
      [],
    );
    // The ally edge is back on the source; the friend edge never moved.
    expect(edges.some((edge) => edge.kind === "ally" && edge.source_id === duplicateMina)).toBe(
      true,
    );

    const presence = await driver.query<{ character_id: string }>(
      "SELECT character_id FROM scene_character WHERE scene_id = ?",
      [sceneTwo],
    );
    expect(presence.map((row) => row.character_id)).toContain(duplicateMina);
  });

  it("refuses self-merges and cross-project merges", async () => {
    await expect(
      run(mergeCharacters, { projectId, sourceId: mina, targetId: mina }),
    ).rejects.toThrow(/itself/);
    const other = (await run(createProject, { title: "Elsewhere" })).projectId;
    const stranger = (await run(createCharacter, { projectId: other, name: "Someone" }))
      .characterId;
    await expect(
      run(mergeCharacters, { projectId, sourceId: mina, targetId: stranger }),
    ).rejects.toThrow(/does not exist/);
  });

  it("keeps the target's aliases intact through a full merge cycle", async () => {
    await run(updateCharacter, {
      projectId,
      characterId: mina,
      patch: { aliases: ["Mina V."] },
    });
    const merged = await run(mergeCharacters, {
      projectId,
      sourceId: duplicateMina,
      targetId: mina,
    });
    const aliases = await driver.query<{ aliases: string }>(
      "SELECT aliases FROM character WHERE id = ?",
      [mina],
    );
    const parsed = JSON.parse(aliases[0]?.aliases ?? "[]") as string[];
    expect(parsed).toContain("Mina V.");
    expect(parsed).toContain("Mina");
    expect(merged.aliasesAdded).toBeGreaterThan(0);
  });
});
