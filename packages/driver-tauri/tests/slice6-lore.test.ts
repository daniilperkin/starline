import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChangeBus,
  type Command,
  createLoreCategory,
  createLoreEntry,
  createProject,
  deleteLoreCategory,
  deleteLoreEntry,
  executeCommand,
  listFieldDefs,
  listLoreCategories,
  listLoreEntries,
  listMentionables,
  makeRichText,
  moveLoreCategory,
  moveLoreEntry,
  type PMDoc,
  seedLoreTaxonomy,
  setFieldValue,
  type UUID,
  updateLoreEntry,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 6 integration: the lore wiki against the real native driver (rusqlite via the stdio
 * CLI) — taxonomy seeding, cycle refusal, kind-template seeding, mention mirroring and the
 * cascade rules of category deletion.
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

async function countMentions(targetId: UUID): Promise<number> {
  const rows = await driver.query<{ n: number }>(
    "SELECT COALESCE(SUM(count), 0) AS n FROM mention WHERE target_type = 'lore' AND target_id = ?",
    [targetId],
  );
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice6-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (await run(createProject, { title: "Slice 6" })).projectId;
});

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("lore taxonomy", () => {
  it("seeds nine categories once and refuses a second seeding", async () => {
    const first = await run(seedLoreTaxonomy, { projectId });
    expect(first.created).toBe(9);
    const second = await run(seedLoreTaxonomy, { projectId });
    expect(second.created).toBe(0);
    const categories = await listLoreCategories(driver, projectId);
    expect(categories).toHaveLength(9);
    expect(categories.map((category) => category.name)).toContain("Magic & Technology");
  });
});

describe("lore entries", () => {
  it("creates an entry, seeds its kind templates once, and reads it back", async () => {
    const categories = await listLoreCategories(driver, projectId);
    const geography = categories.find((category) => category.defaultKind === "geography");
    expect(geography).toBeDefined();

    const { entryId } = await run(createLoreEntry, {
      projectId,
      name: "The Sundered Coast",
      kind: "geography",
      categoryId: geography?.id ?? null,
    });

    const defs = await listFieldDefs(driver, projectId, "lore", "geography");
    expect(defs.map((def) => def.label)).toEqual(["Terrain", "Climate", "Resources", "Hazards"]);

    // A second entry of the same kind must not duplicate the template defs.
    await run(createLoreEntry, { projectId, name: "The Salt Flats", kind: "geography" });
    const again = await listFieldDefs(driver, projectId, "lore", "geography");
    expect(again).toHaveLength(defs.length);

    const entries = await listLoreEntries(driver, projectId);
    expect(entries.map((entry) => entry.name)).toContain("The Sundered Coast");
    expect(entries.find((entry) => entry.id === entryId)?.categoryId).toBe(geography?.id);
  });

  it("stores custom-field values with per-type validation", async () => {
    const { entryId } = await run(createLoreEntry, {
      projectId,
      name: "House Verrin",
      kind: "faction",
    });
    const defs = await listFieldDefs(driver, projectId, "lore", "faction");
    const strength = defs.find((def) => def.label === "Strength");
    expect(strength).toBeDefined();
    if (!strength) return;

    await run(setFieldValue, {
      defId: strength.id,
      ownerType: "lore",
      ownerId: entryId,
      value: "Major",
    });
    await expect(
      run(setFieldValue, {
        defId: strength.id,
        ownerType: "lore",
        ownerId: entryId,
        value: "Huge",
      }),
    ).rejects.toThrow(/not an option/);

    const rows = await driver.query<{ value: string }>(
      "SELECT value FROM custom_field_value WHERE owner_id = ?",
      [entryId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('"Major"');
  });

  it("mirrors mentions on save and replaces them on the next save", async () => {
    const { entryId } = await run(createLoreEntry, {
      projectId,
      name: "The Glass Sea",
      kind: "location",
    });
    const target = (await run(createLoreEntry, { projectId, name: "Emberfall", kind: "location" }))
      .entryId;

    const docWithMentions: PMDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "North of " },
            {
              type: "mention",
              attrs: { entityType: "lore", entityId: target, label: "Emberfall" },
            },
            { type: "text", text: " and " },
            {
              type: "mention",
              attrs: { entityType: "lore", entityId: target, label: "Emberfall" },
            },
          ],
        },
      ],
    };
    await run(updateLoreEntry, {
      projectId,
      entryId,
      patch: { body: makeRichText(docWithMentions) },
    });
    expect(await countMentions(target)).toBe(2);

    const cleanDoc: PMDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "no links" }] }],
    };
    await run(updateLoreEntry, { projectId, entryId, patch: { body: makeRichText(cleanDoc) } });
    expect(await countMentions(target)).toBe(0);
  });

  it("refuses entry cycles and re-parents children on delete", async () => {
    const country = (
      await run(createLoreEntry, { projectId, name: "Verrinmark", kind: "location" })
    ).entryId;
    const city = (
      await run(createLoreEntry, {
        projectId,
        name: "Emberfall City",
        kind: "location",
        parentEntryId: country,
      })
    ).entryId;

    await expect(
      run(moveLoreEntry, {
        projectId,
        entryId: country,
        categoryId: null,
        parentEntryId: city,
        orderKey: "a5",
      }),
    ).rejects.toThrow(/cycle/);

    // Deleting the country lifts the city up instead of orphaning it.
    await run(deleteLoreEntry, { projectId, entryId: country });
    const rows = await driver.query<{ parent_entry_id: string | null }>(
      "SELECT parent_entry_id FROM lore_entry WHERE id = ?",
      [city],
    );
    expect(rows[0]?.parent_entry_id).toBeNull();
  });
});

describe("lore categories", () => {
  it("refuses category cycles", async () => {
    const parent = (await run(createLoreCategory, { projectId, name: "Inner Sea" })).categoryId;
    const child = (await run(createLoreCategory, { projectId, name: "Islands", parentId: parent }))
      .categoryId;
    await expect(
      run(moveLoreCategory, { projectId, categoryId: parent, parentId: child, orderKey: "a5" }),
    ).rejects.toThrow(/cycle/);
  });

  it("blocks deleting a category that still holds entries unless cascading", async () => {
    const categoryId = (await run(createLoreCategory, { projectId, name: "Ruins" })).categoryId;
    const entryId = (
      await run(createLoreEntry, {
        projectId,
        name: "The Sunken Library",
        kind: "location",
        categoryId,
      })
    ).entryId;

    await expect(run(deleteLoreCategory, { projectId, categoryId })).rejects.toThrow(
      /holds 1 entry/,
    );
    const cascade = await run(deleteLoreCategory, { projectId, categoryId, cascade: true });
    expect(cascade.deletedEntries).toBe(1);

    const entries = await listLoreEntries(driver, projectId);
    expect(entries.find((entry) => entry.id === entryId)).toBeUndefined();
    const categories = await listLoreCategories(driver, projectId);
    expect(categories.find((category) => category.id === categoryId)).toBeUndefined();
  });
});

describe("mentionables", () => {
  it("lists characters and lore entries for the @-picker", async () => {
    const mentionables = await listMentionables(driver, projectId);
    expect(mentionables.some((row) => row.type === "lore" && row.label === "Emberfall")).toBe(true);
  });
});
