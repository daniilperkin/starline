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
  createLoreEntry,
  createProject,
  createScene,
  executeCommand,
  linkMention,
  listBacklinks,
  listPossibleMentions,
  makeRichText,
  type PMDoc,
  runConsistencyChecks,
  searchProject,
  type UUID,
  unlinkMention,
  updateCharacter,
  updateLoreEntry,
  updateScene,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 7 integration: search, backlinks, possible mentions and the consistency checks against
 * the real native driver. Everything here reads what other commands write, so the suite also
 * proves the mention mirror is maintained by scene and character saves — not just lore.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

let driver: TauriStorageDriver;
let transport: StdioTransport;
let dir: string;
let projectId: UUID;
let loreId: UUID;
let otherLoreId: UUID;
let sceneId: UUID;
let characterId: UUID;
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

const mentionDoc = (label: string, entityId: string, entityType = "lore"): PMDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "North of " },
        { type: "mention", attrs: { entityType, entityId, label } },
        { type: "text", text: " the wind never stops." },
      ],
    },
  ],
});

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice7-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (await run(createProject, { title: "Slice 7" })).projectId;

  loreId = (await run(createLoreEntry, { projectId, name: "Emberfall", kind: "location" })).entryId;
  otherLoreId = (
    await run(createLoreEntry, { projectId, name: "The Sundered Coast", kind: "geography" })
  ).entryId;
  characterId = (await run(createCharacter, { projectId, name: "Mira Holt", role: "protagonist" }))
    .characterId;
  sceneId = (
    await run(createScene, {
      projectId,
      title: "The ferry",
      // Plain text on purpose: this is the "unlinked occurrence" the rewrite has to find.
      synopsis: makeRichText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "They reach Emberfall before dawn and wait." }],
          },
        ],
      }),
    })
  ).sceneId;
});

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("possible mentions + link rewrite", () => {
  it("finds the unlinked occurrence in a scene synopsis", async () => {
    const possible = await listPossibleMentions(driver, projectId, "lore", loreId);
    const hit = possible.find((row) => row.sourceId === sceneId);
    expect(hit).toBeDefined();
    expect(hit?.sourceType).toBe("scene");
    expect(hit?.occurrences).toBe(1);
    expect(hit?.snippet).toContain("Emberfall");
  });

  it("rewrites the range into a chip, then the mirror reports it as a backlink", async () => {
    const result = await run<unknown, { linked: number }>(linkMention, {
      projectId,
      sourceType: "scene",
      sourceId: sceneId,
      field: "synopsis",
      targetType: "lore",
      targetId: loreId,
    });
    expect(result.linked).toBe(1);

    const backlinks = await listBacklinks(driver, projectId, "lore", loreId);
    expect(backlinks.sources.map((source) => source.sourceId)).toContain(sceneId);
    expect(backlinks.totalOccurrences).toBe(1);
    expect(backlinks.sources[0]?.snippet).toContain("Emberfall");

    // The mirror is what changed: the possible list no longer shows this source.
    const possible = await listPossibleMentions(driver, projectId, "lore", loreId);
    expect(possible.find((row) => row.sourceId === sceneId)).toBeUndefined();
  });

  it("keeps the prose intact and can be undone exactly", async () => {
    const rows = await driver.query<{ synopsis_text: string }>(
      "SELECT synopsis_text FROM scene WHERE id = ?",
      [sceneId],
    );
    expect(rows[0]?.synopsis_text).toContain("They reach Emberfall before dawn");

    const undone = await run<unknown, { linked: number }>(unlinkMention, {
      projectId,
      sourceType: "scene",
      sourceId: sceneId,
      field: "synopsis",
      targetType: "lore",
      targetId: loreId,
    });
    expect(undone.linked).toBe(1);
    const backlinks = await listBacklinks(driver, projectId, "lore", loreId);
    expect(backlinks.sources).toHaveLength(0);

    // Re-link so the later search/backlink assertions have their source back.
    await run<unknown, { linked: number }>(linkMention, {
      projectId,
      sourceType: "scene",
      sourceId: sceneId,
      field: "synopsis",
      targetType: "lore",
      targetId: loreId,
    });
  });
});

describe("mention mirror from every rich-text save", () => {
  it("mirrors a lore body mention and a character storyline mention", async () => {
    await run(updateLoreEntry, {
      projectId,
      entryId: otherLoreId,
      patch: { body: makeRichText(mentionDoc("Emberfall", loreId)) },
    });
    await run(updateCharacter, {
      projectId,
      characterId,
      patch: { storyline: makeRichText(mentionDoc("Emberfall", loreId)) },
    });

    const backlinks = await listBacklinks(driver, projectId, "lore", loreId);
    const types = backlinks.sources.map((source) => source.sourceType).sort();
    expect(types).toEqual(["character", "lore", "scene"]);
    expect(backlinks.totalOccurrences).toBe(3);
  });

  it("clears the mirror when a mention is removed from the text", async () => {
    const clean: PMDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "no links here" }] }],
    };
    await run(updateCharacter, {
      projectId,
      characterId,
      patch: { storyline: makeRichText(clean) },
    });
    const backlinks = await listBacklinks(driver, projectId, "lore", loreId);
    expect(backlinks.sources.some((source) => source.sourceType === "character")).toBe(false);
  });

  it("mirrors a scene synopsis chip written through updateScene", async () => {
    await run(updateScene, {
      projectId,
      sceneId,
      patch: { synopsis: makeRichText(mentionDoc("Emberfall", loreId)) },
    });
    const backlinks = await listBacklinks(driver, projectId, "lore", loreId);
    const scene = backlinks.sources.find((source) => source.sourceType === "scene");
    expect(scene?.count).toBe(1);
  });
});

describe("global search", () => {
  it("finds titles by prefix and body text by term", async () => {
    const byTitle = await searchProject(driver, projectId, "Emb");
    expect(byTitle.groups.some((group) => group.entityType === "lore")).toBe(true);
    expect(byTitle.groups.flatMap((group) => group.hits).map((hit) => hit.title)).toContain(
      "Emberfall",
    );

    const byBody = await searchProject(driver, projectId, "wind");
    const hit = byBody.groups.flatMap((group) => group.hits)[0];
    expect(hit?.snippet.toLowerCase()).toContain("wind");
    expect(byBody.tookMs).toBeLessThan(250); // generous here; the perf suite pins the budget
  });

  it("finds a misspelled name through the trigram index", async () => {
    const fuzzy = await searchProject(driver, projectId, "mberfal");
    const hit = fuzzy.groups
      .flatMap((group) => group.hits)
      .find((row) => row.title === "Emberfall");
    expect(hit?.fuzzy).toBe(true);
  });

  it("returns nothing for a term that is not there, and never throws on syntax", async () => {
    const missing = await searchProject(driver, projectId, "zzzznotpresent");
    expect(missing.total).toBe(0);
    const syntax = await searchProject(driver, projectId, 'foo" AND (bar) *');
    expect(syntax.groups).toEqual([]);
  });

  it("skips soft-deleted rows", async () => {
    const deleted = (
      await run(createLoreEntry, { projectId, name: "Ghost Town", kind: "location" })
    ).entryId;
    await driver.query("UPDATE lore_entry SET deleted_at = 1 WHERE id = ?", [deleted]);
    const results = await searchProject(driver, projectId, "Ghost Town");
    expect(results.total).toBe(0);
  });
});

describe("consistency checks", () => {
  it("reports empty texts, thin scenes, unused lore and near-duplicate names", async () => {
    await run(createCharacter, { projectId, name: "Mira Hold", role: "supporting" });
    // A scene with no synopsis at all — the step-9 gap the check is meant to surface.
    await run(createScene, { projectId, title: "Unwritten scene" });
    const checks = await runConsistencyChecks(driver, projectId);
    const ids = checks.map((check) => check.id);
    expect(ids).toContain("duplicate-names");
    expect(ids).toContain("character-empty");
    expect(ids).toContain("scene-thin");
    expect(ids).toContain("lore-empty");

    const duplicates = checks.find((check) => check.id === "duplicate-names");
    expect(duplicates?.items.some((item) => item.title === "Mira Holt")).toBe(true);
    const unused = checks.find((check) => check.id === "lore-unused");
    expect(unused?.items.some((item) => item.title === "Emberfall")).toBe(false);
  });
});
