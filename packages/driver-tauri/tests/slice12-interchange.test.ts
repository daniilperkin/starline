import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildExportDocument,
  ChangeBus,
  type Command,
  createChapter,
  createCharacter,
  createLoreEntry,
  createProject,
  createRelationship,
  createScene,
  createTag,
  createTimelineEvent,
  executeCommand,
  linkMention,
  listBacklinks,
  moveScene,
  parseExportDocument,
  readProjectExport,
  richTextFromPlain,
  searchProject,
  serializeExportDocument,
  setEntityTags,
  setGraphPositions,
  setSceneCharacters,
  setScenePlotline,
  type UUID,
  updateCharacter,
  updateScene,
  writeProjectExport,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 12's exit criterion, on the real driver: `export → import → export` must be identical.
 * The second export comes out of a FRESH library that only ever saw the interchange document,
 * so anything the reader and the writer disagree about shows up as a diff here.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

const bus = new ChangeBus();
let dir: string;
let sourcePath: string;
let targetPath: string;
let source: TauriStorageDriver;
let target: TauriStorageDriver;
let sourceTransport: StdioTransport;
let targetTransport: StdioTransport;
let projectId: UUID;

function ensureCliBuilt(): void {
  if (existsSync(binPath) && process.env.STARLINE_REBUILD_CLI !== "1") return;
  execFileSync("node", [join(repoRoot, "scripts", "cargo.mjs"), "build"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

async function openLibrary(
  path: string,
): Promise<{ driver: TauriStorageDriver; transport: StdioTransport }> {
  const transport = new StdioTransport({
    command: binPath,
    env: { STARLINE_LOCK_STALE_MS: "500" },
  });
  const instance = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await instance.open({ path, create: true, readOnly: false });
  await runMigrations(instance);
  return { driver: instance, transport };
}

async function run<A, R>(driver: TauriStorageDriver, command: Command<A, R>, args: A): Promise<R> {
  return executeCommand({ transaction: (fn) => driver.transaction(fn) }, bus, command, args);
}

/** The bytes of one export, with the only volatile field removed. */
function stable(text: string): string {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  parsed.exportedAt = 0;
  return JSON.stringify(parsed, null, 2);
}

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice12-"));
  sourcePath = join(dir, "source.starline");
  targetPath = join(dir, "target.starline");
  const a = await openLibrary(sourcePath);
  source = a.driver;
  sourceTransport = a.transport;
  const b = await openLibrary(targetPath);
  target = b.driver;
  targetTransport = b.transport;
});

afterAll(async () => {
  await source?.close().catch(() => undefined);
  await target?.close().catch(() => undefined);
  await sourceTransport?.dispose().catch(() => undefined);
  await targetTransport?.dispose().catch(() => undefined);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("interchange round trip", () => {
  it("builds a project worth exporting", async () => {
    projectId = (await run(source, createProject, { title: "The Cartographer's Sea" })).projectId;
    const mina = (
      await run(source, createCharacter, { projectId, name: "Mina Voss", role: "protagonist" })
    ).characterId;
    const tor = (
      await run(source, createCharacter, { projectId, name: "Tor Halden", role: "major" })
    ).characterId;
    await run(source, updateCharacter, {
      projectId,
      characterId: mina,
      patch: {
        oneLine: "The cartographer who cannot go home",
        storyline: richTextFromPlain("Mina maps a sea that keeps moving."),
        motivation: "A safe harbour",
        goal: "To map the moving sea",
      },
    });
    const harbour = (
      await run(source, createLoreEntry, { projectId, name: "Harbour", kind: "location" })
    ).entryId;
    // A second lore entry so the export has a row that no scene points at.
    await run(source, createLoreEntry, { projectId, name: "The comet", kind: "history_event" });
    const chapter = (await run(source, createChapter, { projectId, title: "Chapter one" }))
      .chapterId;
    const sceneA = (await run(source, createScene, { projectId, title: "The ferry" })).sceneId;
    const sceneB = (await run(source, createScene, { projectId, title: "The ridge road" })).sceneId;
    await run(source, updateScene, {
      projectId,
      sceneId: sceneA,
      patch: {
        synopsis: richTextFromPlain("Mina takes the ferry across a cold harbour."),
        locationId: harbour,
        status: "drafted",
        storyTime: 39_299_904_000,
        storyTimeLabel: "the night of the storm",
      },
    });
    // A real mention chip on the synopsis: the importer must rebuild the mention mirror from it.
    await run(source, linkMention, {
      projectId,
      sourceType: "scene",
      sourceId: sceneA,
      field: "synopsis",
      targetType: "lore",
      targetId: harbour,
    });
    await run(source, moveScene, {
      projectId,
      sceneId: sceneA,
      chapterId: chapter,
      beforeSceneId: null,
    });
    await run(source, setSceneCharacters, {
      projectId,
      sceneId: sceneA,
      characterIds: [mina, tor],
    });
    await run(source, setSceneCharacters, { projectId, sceneId: sceneB, characterIds: [mina] });
    const plotline = (
      await run(source, createTimelineEvent, {
        projectId,
        title: "Untyped event check",
        storyTime: 1,
        lane: "world",
      })
    ).eventId;
    // A real plotline too, so scene_plotline has a row.
    await source.transaction((tx) =>
      tx.query(
        `INSERT INTO plotline (id, project_id, name, description_json, description_text, color, order_key, kind, character_id, created_at, updated_at)
         VALUES (?, ?, 'The map', NULL, '', '#88ccff', 'a0', 'main', ?, ?, ?)`,
        [`01a1ba00-0000-7000-8000-000000000001`, projectId, mina, 1, 1],
      ),
    );
    await run(source, setScenePlotline, {
      projectId,
      sceneId: sceneA,
      plotlineId: `01a1ba00-0000-7000-8000-000000000001` as UUID,
      attached: true,
      beat: "the map points wrong",
    });
    await run(source, createRelationship, {
      projectId,
      sourceId: mina,
      targetId: tor,
      kind: "ally",
      sentiment: 3,
    });
    const tag = (await run(source, createTag, { projectId, name: "Act one" })).tagId;
    await run(source, setEntityTags, {
      projectId,
      entityType: "scene",
      entityId: sceneA,
      tagIds: [tag],
    });
    await run(source, setGraphPositions, {
      projectId,
      positions: { [mina]: { x: 12, y: 34 }, [tor]: { x: 56, y: 78 } },
    });
    // A note and a timeline event (no commands yet for notes — direct rows are still exported).
    await source.transaction((tx) =>
      tx.query(
        `INSERT INTO idea_note (id, project_id, title, kind, status, body_json, body_text, source_url, pinned, color, promoted_to_type, promoted_to_id, order_key, created_at, updated_at)
         VALUES (?, ?, 'A cold harbour', 'idea', 'inbox', NULL, 'Ferries, gulls, a broken compass.', '', 1, NULL, NULL, NULL, 'a0', 5, 5)`,
        ["01a1ba00-0000-7000-8000-000000000002", projectId],
      ),
    );
    await run(source, createTimelineEvent, {
      projectId,
      title: "The comet falls",
      storyTime: 39_299_940_000,
      lane: "world",
      description: "A second sun for eleven days.",
    });
    expect(plotline).toBeTruthy();
    const counts = await source.query<{ scenes: number; characters: number }>(
      `SELECT (SELECT COUNT(*) FROM scene) AS scenes, (SELECT COUNT(*) FROM character) AS characters`,
    );
    expect(counts[0]?.scenes).toBe(2);
    expect(counts[0]?.characters).toBe(2);
  });

  it("exports to JSON, imports into a fresh library and re-exports identically", async () => {
    const first = await source.transaction((tx) => readProjectExport(tx, projectId));
    const firstText = serializeExportDocument(
      buildExportDocument(first, { exportedAt: 1_700_000_000_000 }),
    );
    const parsed = parseExportDocument(firstText);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const report = await target.transaction((tx) => writeProjectExport(tx, parsed.value.data));
    expect(report.issues).toEqual([]);
    expect(report.remapped).toBe(0);
    expect(report.projectId).toBe(projectId);
    expect(report.counts.scenes).toBe(2);
    expect(report.counts.characters).toBe(2);
    expect(report.counts.relationships).toBe(1);
    expect(report.counts.timelineEvents).toBe(2);
    expect(report.counts.notes).toBe(1);

    const second = await target.transaction((tx) => readProjectExport(tx, projectId));
    const secondText = serializeExportDocument(
      buildExportDocument(second, { exportedAt: 1_800_000_000_000 }),
    );
    expect(stable(secondText)).toBe(stable(firstText));
  });

  it("rebuilds mentions, search and the graph pins on the imported copy", async () => {
    const entries = await target.query<{ id: string }>(
      "SELECT id FROM lore_entry WHERE name = 'Harbour'",
    );
    const harbour = entries[0]?.id as UUID;
    // The exporter wrote `[[Harbour]]` as a mention chip; the importer rebuilt the mirror table.
    const backlinks = await listBacklinks(target, projectId, "lore", harbour);
    expect(backlinks.sources.some((source) => source.sourceType === "scene")).toBe(true);

    const found = await searchProject(target, projectId, "ferry");
    const titles = found.groups.flatMap((group) => group.hits.map((hit) => hit.title));
    expect(titles.some((title) => title.includes("The ferry") || title.includes("Ferry"))).toBe(
      true,
    );

    const pins = await target.query<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'graph_positions'",
    );
    const all = JSON.parse(pins[0]?.value ?? "{}") as Record<string, Record<string, unknown>>;
    expect(Object.keys(all[projectId] ?? {}).length).toBe(2);
  });

  it("re-imports the same document into the same library by re-mapping ids", async () => {
    const first = await source.transaction((tx) => readProjectExport(tx, projectId));
    const text = serializeExportDocument(buildExportDocument(first, { exportedAt: 1 }));
    const parsed = parseExportDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const report = await target.transaction((tx) =>
      writeProjectExport(tx, parsed.value.data, { titleSuffix: " (imported)" }),
    );
    // Every id collided: the copy kept its shape under fresh ids.
    expect(report.remapped).toBeGreaterThan(10);
    expect(report.projectId).not.toBe(projectId);
    const projects = await target.query<{ title: string; n: number }>(
      `SELECT title, (SELECT COUNT(*) FROM scene WHERE scene.project_id = project.id) AS n
         FROM project WHERE deleted_at IS NULL ORDER BY created_at`,
    );
    expect(projects.length).toBe(2);
    if (projects.some((row) => (row as unknown as { n: number }).n !== 2)) {
      console.log(
        `  re-import report: ${JSON.stringify({ counts: report.counts, issues: report.issues.slice(0, 4), remapped: report.remapped })}`,
      );
      console.log(`  projects: ${JSON.stringify(projects)}`);
    }
    expect(projects[1]?.title).toBe("The Cartographer's Sea (imported)");
    expect(projects[1]?.n).toBe(2);

    const copy = await target.transaction((tx) => readProjectExport(tx, report.projectId));
    const copyText = serializeExportDocument(buildExportDocument(copy, { exportedAt: 2 }));
    // Same content, different ids: the structure survives the re-map even though the ids differ.
    const originalDoc = JSON.parse(stable(text)) as Record<string, unknown>;
    const copyDoc = JSON.parse(stable(copyText)) as Record<string, unknown>;
    expect(Object.keys(copyDoc).sort()).toEqual(Object.keys(originalDoc).sort());
    expect((copyDoc.scenes as unknown[]).length).toBe((originalDoc.scenes as unknown[]).length);
    expect((copyDoc.relationships as unknown[]).length).toBe(
      (originalDoc.relationships as unknown[]).length,
    );
    // And the copy is internally consistent: its scenes point at its own characters.
    const copyScenes = copyDoc.scenes as Array<Record<string, unknown>>;
    const copyCharacters = copyDoc.characters as Array<Record<string, unknown>>;
    const characterIds = new Set(copyCharacters.map((row) => row.id));
    for (const scene of copyScenes) {
      const pov = scene.pov_character_id;
      if (typeof pov === "string") expect(characterIds.has(pov)).toBe(true);
    }
  });

  it("refuses an export from a newer schema", () => {
    const result = parseExportDocument(
      JSON.stringify({ format: "starline-export", schemaVersion: 99, project: { id: "x" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("newer StarLine");
    }
  });

  it("reports a broken file instead of throwing", () => {
    expect(parseExportDocument("not json at all").ok).toBe(false);
    expect(parseExportDocument(JSON.stringify({ hello: "world" })).ok).toBe(false);
  });
});
