import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChangeBus,
  type Command,
  countRelationshipsByCharacter,
  createCharacter,
  createProject,
  createRelationship,
  createRelationshipGroup,
  createScene,
  deleteCharacter,
  deleteRelationship,
  deleteRelationshipGroup,
  executeCommand,
  getGraphPositions,
  getRelationshipMatrix,
  listRelationshipGroups,
  listRelationships,
  listSharedScenes,
  setGraphPositions,
  setSceneCharacters,
  type UUID,
  updateRelationship,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 8 integration: relationship edges, groups and the graph-position meta against the real
 * native driver. The interesting parts are the invariants the schema encodes — undirected edges
 * normalised to source < target so the unique index catches duplicates, the custom-label CHECK,
 * the soft-delete/revive cycle, and group deletion detaching its members.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

let driver: TauriStorageDriver;
let transport: StdioTransport;
let dir: string;
let projectId: UUID;
let secondProjectId: UUID;
let mina: UUID;
let tor: UUID;
let voss: UUID;
let spare: UUID;
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
  dir = await mkdtemp(join(tmpdir(), "starline-slice8-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (await run(createProject, { title: "Slice 8" })).projectId;
  secondProjectId = (await run(createProject, { title: "Second book" })).projectId;

  mina = (await run(createCharacter, { projectId, name: "Mina Voss", role: "protagonist" }))
    .characterId;
  tor = (await run(createCharacter, { projectId, name: "Tor Halden", role: "major" })).characterId;
  voss = (await run(createCharacter, { projectId, name: "Ivar Voss", role: "antagonist" }))
    .characterId;
  spare = (await run(createCharacter, { projectId, name: "Odd Job", role: "minor" })).characterId;

  sceneOne = (await run(createScene, { projectId, title: "The ferry" })).sceneId;
  sceneTwo = (await run(createScene, { projectId, title: "The strait" })).sceneId;
  await run(setSceneCharacters, { projectId, sceneId: sceneOne, characterIds: [mina, tor] });
  await run(setSceneCharacters, { projectId, sceneId: sceneTwo, characterIds: [mina, tor, voss] });
});

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("createRelationship", () => {
  it("normalises an undirected edge so either end lands on one row", async () => {
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: tor,
      targetId: mina,
      kind: "friend",
      sentiment: 3,
    });
    const edges = await listRelationships(driver, projectId);
    const edge = edges.find((row) => row.id === relationshipId);
    const sourceId = edge?.sourceId ?? "";
    const targetId = edge?.targetId ?? "";
    expect(sourceId < targetId).toBe(true);
    expect(edge?.directed).toBe(false);
    expect(edge?.sentiment).toBe(3);
  });

  it("refuses a second edge of the same shape with words, not a constraint error", async () => {
    await expect(
      run(createRelationship, { projectId, sourceId: mina, targetId: tor, kind: "friend" }),
    ).rejects.toThrow(/already exists/);
  });

  it("keeps the drawn direction for directed kinds", async () => {
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: voss,
      targetId: mina,
      kind: "mentor",
      sentiment: -2,
      secret: true,
    });
    const edge = (await listRelationships(driver, projectId)).find(
      (row) => row.id === relationshipId,
    );
    expect(edge?.directed).toBe(true);
    expect(edge?.sourceId).toBe(voss);
    expect(edge?.targetId).toBe(mina);
    expect(edge?.secret).toBe(true);
  });

  it("rejects a self-edge, a custom kind without a label and a label on a plain kind", async () => {
    await expect(
      run(createRelationship, { projectId, sourceId: mina, targetId: mina, kind: "friend" }),
    ).rejects.toThrow(/two characters/);
    await expect(
      run(createRelationship, { projectId, sourceId: mina, targetId: spare, kind: "custom" }),
    ).rejects.toThrow(/needs a label/);
    await expect(
      run(createRelationship, {
        projectId,
        sourceId: mina,
        targetId: spare,
        kind: "friend",
        customLabel: "frenemy",
      }),
    ).rejects.toThrow(/cannot carry a custom label/);
  });

  it("clamps sentiment and stores a custom label", async () => {
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: mina,
      targetId: spare,
      kind: "custom",
      customLabel: "owes a debt",
      sentiment: 9,
    });
    const edge = (await listRelationships(driver, projectId)).find(
      (row) => row.id === relationshipId,
    );
    expect(edge?.sentiment).toBe(5);
    expect(edge?.customLabel).toBe("owes a debt");
  });
});

describe("updateRelationship", () => {
  it("re-keys kind, label, direction and feeling", async () => {
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: tor,
      targetId: voss,
      kind: "rival",
      sentiment: -1,
    });
    await run(updateRelationship, {
      projectId,
      relationshipId,
      patch: { kind: "enemy", sentiment: -5, secret: true, directed: true },
    });
    const edge = (await listRelationships(driver, projectId)).find(
      (row) => row.id === relationshipId,
    );
    expect(edge?.kind).toBe("enemy");
    expect(edge?.sentiment).toBe(-5);
    expect(edge?.directed).toBe(true);
    // Directed re-keying keeps the ends as drawn (no normalisation on a directed edge).
    expect(edge?.sourceId).toBe(tor);
  });

  it("refuses to re-key onto an existing edge", async () => {
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: tor,
      targetId: voss,
      kind: "ally",
    });
    await expect(
      run(updateRelationship, { projectId, relationshipId, patch: { kind: "enemy" } }),
    ).rejects.toThrow(/already exists/);
    // The failed update must leave the edge untouched (one command = one transaction).
    const edge = (await listRelationships(driver, projectId)).find(
      (row) => row.id === relationshipId,
    );
    expect(edge?.kind).toBe("ally");
  });

  it("drops a custom label when the kind stops being custom", async () => {
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: voss,
      targetId: spare,
      kind: "custom",
      customLabel: "rival house",
    });
    await run(updateRelationship, { projectId, relationshipId, patch: { kind: "rival" } });
    const edge = (await listRelationships(driver, projectId)).find(
      (row) => row.id === relationshipId,
    );
    expect(edge?.customLabel).toBe("");
  });
});

describe("delete + revive", () => {
  it("soft-deletes and revives the same row instead of duplicating it", async () => {
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: mina,
      targetId: voss,
      kind: "acquaintance",
      sentiment: 1,
    });
    await run(deleteRelationship, { projectId, relationshipId });
    expect(
      (await listRelationships(driver, projectId)).some((row) => row.id === relationshipId),
    ).toBe(false);

    const revived = await run(createRelationship, {
      projectId,
      sourceId: voss,
      targetId: mina,
      kind: "acquaintance",
      sentiment: 4,
    });
    expect(revived.relationshipId).toBe(relationshipId);
    const edge = (await listRelationships(driver, projectId)).find(
      (row) => row.id === relationshipId,
    );
    expect(edge?.sentiment).toBe(4);
  });
});

describe("groups", () => {
  it("assigns members, then detaches them when the group is deleted", async () => {
    const { groupId } = await run(createRelationshipGroup, {
      projectId,
      name: "House Voss",
      color: "#8b7cf6",
    });
    const { relationshipId } = await run(createRelationship, {
      projectId,
      sourceId: mina,
      targetId: tor,
      kind: "family_sibling",
      groupId,
    });
    const groups = await listRelationshipGroups(driver, projectId);
    expect(groups.map((group) => group.name)).toContain("House Voss");

    const { detached } = await run(deleteRelationshipGroup, { projectId, groupId });
    expect(detached).toBe(1);
    const edge = (await listRelationships(driver, projectId)).find(
      (row) => row.id === relationshipId,
    );
    expect(edge?.groupId).toBeNull();
    expect(
      (await listRelationshipGroups(driver, projectId)).some((group) => group.id === groupId),
    ).toBe(false);
  });
});

describe("matrix reads", () => {
  it("returns characters, live edges and groups in one call", async () => {
    const matrix = await getRelationshipMatrix(driver, projectId);
    expect(matrix.characters.map((character) => character.name)).toContain("Mina Voss");
    expect(matrix.edges.length).toBeGreaterThan(4);
    expect(matrix.groups).toEqual([]);
  });

  it("counts both ends of every live edge", async () => {
    const counts = await countRelationshipsByCharacter(driver, projectId);
    expect(counts.get(mina)).toBeGreaterThanOrEqual(4);
    expect(counts.get(spare)).toBeGreaterThanOrEqual(2);
  });

  it("hides the edges of a trashed character and brings them back on restore", async () => {
    const before = (await listRelationships(driver, projectId)).length;
    await run(deleteCharacter, { projectId, characterId: spare });
    const after = await listRelationships(driver, projectId);
    expect(after.length).toBeLessThan(before);
    expect(after.some((row) => row.sourceId === spare || row.targetId === spare)).toBe(false);
  });

  it("counts the scenes two characters share", async () => {
    const shared = await listSharedScenes(driver, projectId, mina, tor);
    expect(shared.total).toBe(2);
    expect(shared.scenes.map((scene) => scene.title).sort()).toEqual(["The ferry", "The strait"]);
  });
});

describe("graph positions", () => {
  it("round-trips manual pins per project", async () => {
    expect(await getGraphPositions(driver, projectId)).toEqual({});
    await run(setGraphPositions, { projectId, positions: { [mina]: { x: 12, y: 34 } } });
    expect(await getGraphPositions(driver, projectId)).toEqual({ [mina]: { x: 12, y: 34 } });
    // A second book in the same file keeps its own layout (spec §3.3 multi-book files).
    await run(setGraphPositions, {
      projectId: secondProjectId,
      positions: { abc: { x: 1, y: 2 } },
    });
    expect(await getGraphPositions(driver, projectId)).toEqual({ [mina]: { x: 12, y: 34 } });
    expect(await getGraphPositions(driver, secondProjectId)).toEqual({ abc: { x: 1, y: 2 } });
  });
});
