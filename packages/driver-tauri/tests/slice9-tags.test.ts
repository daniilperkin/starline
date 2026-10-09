import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChangeBus,
  type Command,
  clearFieldValue,
  countFieldValues,
  countFieldValuesByDef,
  countTagUsage,
  createChapter,
  createCharacter,
  createFieldDef,
  createLoreEntry,
  createPlotline,
  createProject,
  createScene,
  createTag,
  deleteCharacter,
  deleteFieldDef,
  deleteScene,
  deleteTag,
  executeCommand,
  formatBalance,
  getPlotlineBalance,
  getPlotlineGrid,
  gridCellKey,
  listAllFieldDefs,
  listEntityTags,
  listFieldDefs,
  listFieldValues,
  listTags,
  listTagsForEntities,
  mergeTags,
  moveFieldDef,
  renameTag,
  setEntityTags,
  setFieldValue,
  setScenePlotline,
  setTagColor,
  toggleEntityTag,
  type UUID,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 9 integration against the real native driver: the tag manager's invariants (unique
 * names, merging that never loses an attachment, targets that must exist), the custom-field
 * definitions the Settings screen manages, and the plotline grid's read/write plus its balance
 * statistics — the slice's exit criteria ("a field appears on every existing entity
 * immediately", "grid read/write", "stats correct on the reference project").
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
let loreEntryId: UUID;
let chapterId: UUID;
let plotlineA: UUID;
let plotlineB: UUID;
/** 12 scenes: chapter scenes first, then the unassigned pool. */
let scenes: UUID[] = [];
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
  dir = await mkdtemp(join(tmpdir(), "starline-slice9-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (await run(createProject, { title: "Slice 9" })).projectId;
  secondProjectId = (await run(createProject, { title: "Second book" })).projectId;

  mina = (await run(createCharacter, { projectId, name: "Mina Voss", role: "protagonist" }))
    .characterId;
  tor = (await run(createCharacter, { projectId, name: "Tor Halden", role: "major" })).characterId;
  chapterId = (await run(createChapter, { projectId, title: "Part one" })).chapterId;

  loreEntryId = (
    await run(createLoreEntry, { projectId, name: "The ferry crossing", kind: "location" })
  ).entryId;

  scenes = [];
  for (let index = 0; index < 12; index += 1) {
    const created = await run(createScene, {
      projectId,
      chapterId: index < 8 ? chapterId : null,
      title: `Scene ${index + 1}`,
    });
    scenes.push(created.sceneId);
  }

  plotlineA = (await run(createPlotline, { projectId, name: "The debt" })).plotlineId;
  plotlineB = (await run(createPlotline, { projectId, name: "The ferry", kind: "subplot" }))
    .plotlineId;
});

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("tag manager", () => {
  it("creates a tag, gives it a colour and counts nothing yet", async () => {
    const { tagId } = await run(createTag, { projectId, name: "  red   herring " });
    const tags = await listTags(driver, projectId);
    const tag = tags.find((row) => row.id === tagId);
    expect(tag?.name).toBe("red herring");
    expect(tag?.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tag?.count).toBe(0);
  });

  it("refuses a duplicate name in any case, with words", async () => {
    await expect(run(createTag, { projectId, name: "Red Herring" })).rejects.toThrow(
      /already exists/,
    );
  });

  it("keeps names unique per project, not per file", async () => {
    const { tagId } = await run(createTag, { projectId: secondProjectId, name: "red herring" });
    const other = await listTags(driver, secondProjectId);
    expect(other.some((row) => row.id === tagId)).toBe(true);
    expect((await listTags(driver, projectId)).some((row) => row.id === tagId)).toBe(false);
  });

  it("renames, allows a pure case change, and refuses another tag's name", async () => {
    const { tagId } = await run(createTag, { projectId, name: "B-plot" });
    await run(renameTag, { projectId, tagId, name: "b-plot" });
    expect((await listTags(driver, projectId)).find((row) => row.id === tagId)?.name).toBe(
      "b-plot",
    );
    await expect(run(renameTag, { projectId, tagId, name: "red herring" })).rejects.toThrow(
      /already exists/,
    );
  });

  it("recolours with a validated hex", async () => {
    const tags = await listTags(driver, projectId);
    const tagId = tags.find((row) => row.name === "b-plot")?.id as UUID;
    await run(setTagColor, { projectId, tagId, color: "#ff00aa" });
    expect((await listTags(driver, projectId)).find((row) => row.id === tagId)?.color).toBe(
      "#ff00aa",
    );
    await expect(run(setTagColor, { projectId, tagId, color: "pink" })).rejects.toThrow(/#RRGGBB/);
  });

  it("attaches to a scene, a character and lore, and counts every attachment", async () => {
    const tags = await listTags(driver, projectId);
    const red = tags.find((row) => row.name === "red herring")?.id as UUID;
    const bplot = tags.find((row) => row.name === "b-plot")?.id as UUID;
    await run(setEntityTags, {
      projectId,
      entityType: "scene",
      entityId: scenes[0] as UUID,
      tagIds: [red, bplot],
    });
    await run(setEntityTags, {
      projectId,
      entityType: "character",
      entityId: mina,
      tagIds: [red],
    });
    await run(setEntityTags, {
      projectId,
      entityType: "lore_entry",
      entityId: loreEntryId,
      tagIds: [red],
    });
    const after = await listTags(driver, projectId);
    expect(after.find((row) => row.id === red)?.count).toBe(3);
    expect(after.find((row) => row.id === bplot)?.count).toBe(1);
    expect(
      (await listEntityTags(driver, "scene", scenes[0] as UUID)).map((row) => row.name),
    ).toEqual(["b-plot", "red herring"]);
  });

  it("returns chips for a whole list in one call", async () => {
    const byEntity = await listTagsForEntities(driver, "scene", [
      scenes[0] as UUID,
      scenes[1] as UUID,
    ]);
    expect(byEntity.get(scenes[0] as UUID)?.length).toBe(2);
    expect(byEntity.get(scenes[1] as UUID)).toBeUndefined();
  });

  it("toggles a single tag without touching the rest", async () => {
    const tags = await listTags(driver, projectId);
    const red = tags.find((row) => row.name === "red herring")?.id as UUID;
    await run(toggleEntityTag, {
      projectId,
      entityType: "scene",
      entityId: scenes[1] as UUID,
      tagId: red,
      attach: true,
    });
    expect((await listEntityTags(driver, "scene", scenes[1] as UUID)).length).toBe(1);
    await run(toggleEntityTag, {
      projectId,
      entityType: "scene",
      entityId: scenes[1] as UUID,
      tagId: red,
      attach: false,
    });
    expect((await listEntityTags(driver, "scene", scenes[1] as UUID)).length).toBe(0);
  });

  it("refuses to attach to a missing or trashed entity", async () => {
    const tags = await listTags(driver, projectId);
    const red = tags.find((row) => row.name === "red herring")?.id as UUID;
    await expect(
      run(setEntityTags, {
        projectId,
        entityType: "character",
        entityId: "00000000-0000-7000-8000-000000000000" as UUID,
        tagIds: [red],
      }),
    ).rejects.toThrow(/not found/);
    await run(deleteCharacter, { projectId, characterId: tor });
    await expect(
      run(toggleEntityTag, {
        projectId,
        entityType: "character",
        entityId: tor,
        tagId: red,
        attach: true,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("merges without losing an attachment, even when both tags are on one item", async () => {
    const tags = await listTags(driver, projectId);
    const red = tags.find((row) => row.name === "red herring")?.id as UUID;
    const bplot = tags.find((row) => row.name === "b-plot")?.id as UUID;
    // scenes[0] carries both; the character and the lore entry carry red only.
    const { moved } = await run(mergeTags, {
      projectId,
      sourceTagId: red,
      targetTagId: bplot,
    });
    expect(moved).toBe(3);
    const after = await listTags(driver, projectId);
    expect(after.find((row) => row.id === red)).toBeUndefined();
    expect(after.find((row) => row.id === bplot)?.count).toBe(3);
    expect((await listEntityTags(driver, "scene", scenes[0] as UUID)).length).toBe(1);
    await expect(
      run(mergeTags, { projectId, sourceTagId: bplot, targetTagId: bplot }),
    ).rejects.toThrow(/different tags/);
  });

  it("deletes a tag and reports what it detached", async () => {
    const tags = await listTags(driver, projectId);
    const bplot = tags.find((row) => row.name === "b-plot")?.id as UUID;
    expect(await countTagUsage(driver, bplot)).toBe(3);
    const { detached } = await run(deleteTag, { projectId, tagId: bplot });
    expect(detached).toBe(3);
    expect(await listTags(driver, projectId)).toHaveLength(0);
    expect((await listEntityTags(driver, "scene", scenes[0] as UUID)).length).toBe(0);
  });
});

describe("custom field definitions", () => {
  it("shows a new scene field on every existing scene immediately", async () => {
    const { defId } = await run(createFieldDef, {
      projectId,
      target: "scene",
      label: "POV camera",
      type: "text",
      section: "Craft",
    });
    const defs = await listFieldDefs(driver, projectId, "scene");
    expect(defs.map((def) => def.id)).toContain(defId);
    // Nothing to backfill: the form renders every def for the target, so all 12 scenes have it.
    for (const sceneId of scenes.slice(0, 3)) {
      await run(setFieldValue, { defId, ownerType: "scene", ownerId: sceneId, value: "wide" });
    }
    expect(await countFieldValues(driver, defId)).toBe(3);
    const values = await listFieldValues(driver, "scene", scenes[0] as UUID);
    expect(values.get(defId)).toBe("wide");
  });

  it("validates every type through one door", async () => {
    const { defId: numberId } = await run(createFieldDef, {
      projectId,
      target: "scene",
      label: "Tension",
      type: "number",
    });
    await run(setFieldValue, {
      defId: numberId,
      ownerType: "scene",
      ownerId: scenes[0] as UUID,
      value: 7,
    });
    await expect(
      run(setFieldValue, {
        defId: numberId,
        ownerType: "scene",
        ownerId: scenes[0] as UUID,
        value: "high",
      }),
    ).rejects.toThrow(/number/);

    const { defId: selectId } = await run(createFieldDef, {
      projectId,
      target: "character",
      label: "Tier",
      type: "select",
      options: ["lead", "support"],
    });
    await run(setFieldValue, {
      defId: selectId,
      ownerType: "character",
      ownerId: mina,
      value: "lead",
    });
    await expect(
      run(setFieldValue, {
        defId: selectId,
        ownerType: "character",
        ownerId: mina,
        value: "extra",
      }),
    ).rejects.toThrow(/not an option/);

    const { defId: dateId } = await run(createFieldDef, {
      projectId,
      target: "location",
      label: "Founded",
      type: "date",
    });
    await expect(
      run(setFieldValue, {
        defId: dateId,
        ownerType: "location",
        ownerId: loreEntryId,
        value: "12.05.1990",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    await run(setFieldValue, {
      defId: dateId,
      ownerType: "location",
      ownerId: loreEntryId,
      value: "1990-05-12",
    });
    expect((await listFieldValues(driver, "location", loreEntryId)).get(dateId)).toBe("1990-05-12");

    const { defId: boolId } = await run(createFieldDef, {
      projectId,
      target: "scene",
      label: "Flashback",
      type: "boolean",
    });
    await run(setFieldValue, {
      defId: boolId,
      ownerType: "scene",
      ownerId: scenes[1] as UUID,
      value: true,
    });
    await run(clearFieldValue, { defId: boolId, ownerType: "scene", ownerId: scenes[1] as UUID });
    expect((await listFieldValues(driver, "scene", scenes[1] as UUID)).has(boolId)).toBe(false);
  });

  it("scopes a lore field to one kind and lists it beside the unscoped ones", async () => {
    const { defId } = await run(createFieldDef, {
      projectId,
      target: "lore",
      loreKind: "location",
      label: "Population trend",
      type: "text",
    });
    const scoped = await listFieldDefs(driver, projectId, "lore", "location");
    expect(scoped.map((def) => def.id)).toContain(defId);
    const otherKind = await listFieldDefs(driver, projectId, "lore", "magic");
    expect(otherKind.map((def) => def.id)).not.toContain(defId);
  });

  it("refuses a duplicate label inside the same scope — including a lore kind template", async () => {
    await expect(
      run(createFieldDef, { projectId, target: "scene", label: "Tension", type: "number" }),
    ).rejects.toThrow();
    // Slice 6 seeds the location kind's template fields on first use, so "Population" is taken.
    await expect(
      run(createFieldDef, {
        projectId,
        target: "lore",
        loreKind: "location",
        label: "Population",
        type: "number",
      }),
    ).rejects.toThrow();
  });

  it("reorders within its own list", async () => {
    const before = await listFieldDefs(driver, projectId, "scene");
    const labels = before.map((def) => def.label);
    expect(labels.length).toBeGreaterThanOrEqual(2);
    const second = before[1];
    if (!second) throw new Error("expected a second field");
    await run(moveFieldDef, { projectId, defId: second.id, direction: "up" });
    const after = await listFieldDefs(driver, projectId, "scene");
    expect(after.map((def) => def.label)).toEqual([labels[1], labels[0], ...labels.slice(2)]);
    await run(moveFieldDef, { projectId, defId: second.id, direction: "up" });
    const top = await listFieldDefs(driver, projectId, "scene");
    expect(top[0]?.id).toBe(second.id);
  });

  it("counts usage per definition for the settings list", async () => {
    const counts = await countFieldValuesByDef(driver, projectId);
    const all = await listAllFieldDefs(driver, projectId);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it("soft-deletes a definition and hides it everywhere", async () => {
    const sceneDefs = await listFieldDefs(driver, projectId, "scene");
    const victim = sceneDefs[0];
    if (!victim) throw new Error("expected a field");
    await run(deleteFieldDef, { projectId, defId: victim.id });
    expect((await listFieldDefs(driver, projectId, "scene")).map((def) => def.id)).not.toContain(
      victim.id,
    );
    expect((await listAllFieldDefs(driver, projectId)).map((def) => def.id)).not.toContain(
      victim.id,
    );
  });
});

describe("plotline grid", () => {
  it("returns plotline rows and scene columns in book order", async () => {
    const grid = await getPlotlineGrid(driver, projectId);
    expect(grid.plotlines.map((row) => row.name)).toEqual(["The debt", "The ferry"]);
    expect(grid.scenes).toHaveLength(12);
    expect(grid.scenes[0]?.title).toBe("Scene 1");
    expect(grid.scenes[0]?.chapterTitle).toBe("Part one");
    // The unassigned pool is last, exactly as in the outliner.
    expect(grid.scenes[11]?.chapterId).toBeNull();
    expect(grid.scenes[11]?.title).toBe("Scene 12");
  });

  it("writes a cell through the scene-plotline command and reads it back", async () => {
    await run(setScenePlotline, {
      projectId,
      sceneId: scenes[0] as UUID,
      plotlineId: plotlineA,
      attached: true,
      beat: "The letter arrives",
    });
    const grid = await getPlotlineGrid(driver, projectId);
    expect(grid.cells[gridCellKey(plotlineA, scenes[0] as UUID)]?.beat).toBe("The letter arrives");
    await run(setScenePlotline, {
      projectId,
      sceneId: scenes[0] as UUID,
      plotlineId: plotlineA,
      attached: false,
    });
    expect(
      (await getPlotlineGrid(driver, projectId)).cells[gridCellKey(plotlineA, scenes[0] as UUID)],
    ).toBeUndefined();
  });

  it("reports balance with the longest gap in book order", async () => {
    // A: scenes 1 and 12 → gap 10; B: scenes 1–3 → no gap.
    await run(setScenePlotline, {
      projectId,
      sceneId: scenes[0] as UUID,
      plotlineId: plotlineA,
      attached: true,
    });
    await run(setScenePlotline, {
      projectId,
      sceneId: scenes[11] as UUID,
      plotlineId: plotlineA,
      attached: true,
    });
    for (const index of [0, 1, 2]) {
      await run(setScenePlotline, {
        projectId,
        sceneId: scenes[index] as UUID,
        plotlineId: plotlineB,
        attached: true,
      });
    }
    const balance = await getPlotlineBalance(driver, projectId);
    const a = balance.find((row) => row.plotlineId === plotlineA);
    const b = balance.find((row) => row.plotlineId === plotlineB);
    expect(a?.appearsIn).toBe(2);
    expect(a?.totalScenes).toBe(12);
    expect(a?.longestGap).toBe(10);
    expect(a?.firstIndex).toBe(0);
    expect(a?.lastIndex).toBe(11);
    // 10 > 25 % of 12 → the spec's warning.
    expect(a?.warn).toBe(true);
    expect(b?.appearsIn).toBe(3);
    expect(b?.longestGap).toBe(0);
    expect(b?.warn).toBe(false);
    expect(a ? formatBalance(a) : "").toBe("2 of 12 scenes; longest gap 10");
  });

  it("leaves a trashed scene out of both the columns and the totals", async () => {
    await run(deleteScene, { projectId, sceneId: scenes[2] as UUID });
    const grid = await getPlotlineGrid(driver, projectId);
    expect(grid.scenes).toHaveLength(11);
    const balance = await getPlotlineBalance(driver, projectId);
    const b = balance.find((row) => row.plotlineId === plotlineB);
    expect(b?.totalScenes).toBe(11);
    expect(b?.appearsIn).toBe(2);
  });
});
