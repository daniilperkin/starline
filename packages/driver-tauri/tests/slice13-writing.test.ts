import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ChangeBus,
  type Command,
  countWords,
  createChapter,
  createCharacter,
  createProject,
  createScene,
  deleteScene,
  executeCommand,
  getContinueTarget,
  getDashboardStats,
  getEditorState,
  getSceneBody,
  listBacklinks,
  listPossibleMentions,
  makeRichText,
  moveScene,
  richTextFromPlain,
  searchProject,
  setEditorLastScene,
  setSceneBody,
  type UUID,
  updateCharacter,
  updateScene,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 13 on the real driver: the draft body is written, counted, indexed and mirrored; the
 * editor remembers where the writer stopped; the dashboard reports written words, not just the
 * estimate. These are the invariants the writing screen leans on — it debounces 400 ms and
 * trusts every one of them.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

const bus = new ChangeBus();
let dir: string;
let driver: TauriStorageDriver;
let transport: StdioTransport;
let projectId: UUID;

function ensureCliBuilt(): void {
  if (existsSync(binPath) && process.env.STARLINE_REBUILD_CLI !== "1") return;
  execFileSync("node", [join(repoRoot, "scripts", "cargo.mjs"), "build"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

async function openLibrary(path: string): Promise<{
  driver: TauriStorageDriver;
  transport: StdioTransport;
}> {
  const stdio = new StdioTransport({ command: binPath });
  const instance = new TauriStorageDriver(stdio, { watchIntervalMs: 0 });
  await instance.open({ path, create: true, readOnly: false });
  await runMigrations(instance);
  return { driver: instance, transport: stdio };
}

async function run<A, R>(target: TauriStorageDriver, command: Command<A, R>, args: A): Promise<R> {
  return executeCommand({ transaction: (fn) => target.transaction(fn) }, bus, command, args);
}

/** A rich-text document with a real mention chip — what the editor writes while typing `@`. */
function proseWithMention(text: string, entityId: UUID, label: string) {
  return makeRichText({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Then " },
          { type: "mention", attrs: { entityId, entityType: "character", label } },
          { type: "text", text: " spoke again." },
        ],
      },
    ],
  });
}

let mina: UUID;
let chapterOne: UUID;
let sceneA: UUID;
let sceneB: UUID;
let sceneC: UUID;

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice13-"));
  const opened = await openLibrary(join(dir, "write.starline"));
  driver = opened.driver;
  transport = opened.transport;

  projectId = (await run(driver, createProject, { title: "The Cartographer's Sea" })).projectId;
  mina = (await run(driver, createCharacter, { projectId, name: "Mina Voss", role: "protagonist" }))
    .characterId;
  // A short-name alias: prose says "Mina" far more often than the full name, and the possible-
  // mentions scan matches every label a target can be found by.
  await run(driver, updateCharacter, {
    projectId,
    characterId: mina,
    patch: { aliases: ["Mina"] },
  });
  chapterOne = (await run(driver, createChapter, { projectId, title: "Chapter one" })).chapterId;
  sceneA = (await run(driver, createScene, { projectId, title: "The ferry" })).sceneId;
  sceneB = (await run(driver, createScene, { projectId, title: "The ridge road" })).sceneId;
  sceneC = (await run(driver, createScene, { projectId, title: "The harbour office" })).sceneId;
});

afterAll(async () => {
  await driver?.close().catch(() => undefined);
  await transport?.dispose().catch(() => undefined);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("writing mode", () => {
  it("counts words the way the editor does", () => {
    expect(countWords("One two three.")).toBe(3);
    // Unicode-aware: an em dash is not a word, an apostrophe joins one, Ukrainian is counted.
    expect(countWords("Mina — Tor's map. Вона пише.")).toBe(5);
  });

  it("saves the draft body with count, search index and mention mirror", async () => {
    const body = proseWithMention("The ferry crossed a cold harbour at dawn.", mina, "Mina Voss");
    const result = await run(driver, setSceneBody, { projectId, sceneId: sceneA, body });
    expect(result.wordCount).toBe(body.wordCount);
    // 8 words of prose + "Then Mina Voss spoke again." — the chip's label counts as text.
    expect(body.wordCount).toBe(13);

    const saved = await getSceneBody(driver, projectId, sceneA);
    expect(saved?.body.text).toContain("cold harbour at dawn");
    expect(saved?.body.wordCount).toBe(13);

    // The search index follows the body (FTS trigger on `scene`), not just the synopsis.
    const found = await searchProject(driver, projectId, "harbour");
    const hitIds = found.groups.flatMap((group) => group.hits.map((hit) => hit.entityId));
    expect(hitIds).toContain(sceneA);

    // And the chip inside the prose becomes a backlink on the character, labelled as a draft.
    const backlinks = await listBacklinks(driver, projectId, "character", mina);
    const fromScene = backlinks.sources.find((source) => source.sourceId === sceneA);
    expect(fromScene?.field).toBe("body");
    expect(fromScene?.detail).toContain("draft");
    expect(fromScene?.count).toBe(1);
  });

  it("finds unlinked names in prose as possible mentions", async () => {
    const body = richTextFromPlain("Mina waited, and Mina said nothing. The rain went on.");
    await run(driver, setSceneBody, { projectId, sceneId: sceneB, body });

    const possible = await listPossibleMentions(driver, projectId, "character", mina);
    const fromBody = possible.find((entry) => entry.sourceId === sceneB && entry.field === "body");
    expect(fromBody?.occurrences).toBe(2);
    expect(fromBody?.detail).toBe("draft");
  });

  it("remembers where the writer stopped, per project", async () => {
    expect((await getEditorState(driver, projectId)).lastSceneId).toBeNull();
    await run(driver, setEditorLastScene, { projectId, sceneId: sceneB });
    expect((await getEditorState(driver, projectId)).lastSceneId).toBe(sceneB);
    // Rewriting the same key keeps one row (upsert, not append).
    await run(driver, setEditorLastScene, { projectId, sceneId: sceneA });
    expect((await getEditorState(driver, projectId)).lastSceneId).toBe(sceneA);
  });

  it("offers the last scene, then the next unwritten one, then nothing", async () => {
    // Scene C moves into the chapter; book order puts a chaptered scene ahead of the pool.
    await run(driver, moveScene, {
      projectId,
      sceneId: sceneC,
      chapterId: chapterOne,
      beforeSceneId: null,
    });

    // Where the writer stopped wins — even though scene C is still unwritten.
    let target = await getContinueTarget(driver, projectId);
    expect(target?.sceneId).toBe(sceneA);
    expect(target?.reason).toBe("last");

    // A deleted last scene falls back to the first scene in book order that is not done.
    await run(driver, deleteScene, { projectId, sceneId: sceneA });
    target = await getContinueTarget(driver, projectId);
    expect(target?.sceneId).toBe(sceneC);
    expect(target?.reason).toBe("next");
    expect(target?.chapterId).toBe(chapterOne);

    // Everything wrapped up: the card has nothing to offer.
    await run(driver, updateScene, { projectId, sceneId: sceneB, patch: { status: "done" } });
    await run(driver, updateScene, { projectId, sceneId: sceneC, patch: { status: "done" } });
    expect(await getContinueTarget(driver, projectId)).toBeNull();

    // Back to work on the unassigned one: it is all that is left.
    await run(driver, updateScene, { projectId, sceneId: sceneB, patch: { status: "drafting" } });
    target = await getContinueTarget(driver, projectId);
    expect(target?.sceneId).toBe(sceneB);
    expect(target?.chapterId).toBeNull();
  });

  it("reports written words on the dashboard, next to the estimate", async () => {
    const stats = await getDashboardStats(driver, projectId);
    // Scene A is trashed (its 13 words go with it), scene B's prose stays counted.
    expect(stats.writtenWords).toBe(
      countWords("Mina waited, and Mina said nothing. The rain went on."),
    );
    expect(stats.writtenWords).toBe(10);
    expect(stats.sceneCount).toBe(2);
  });
});
