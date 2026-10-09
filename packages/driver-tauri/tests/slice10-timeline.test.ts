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
  createPlotline,
  createProject,
  createScene,
  createTimelineEvent,
  deleteScene,
  deleteTimelineEvent,
  detectTimelineConflicts,
  executeCommand,
  formatStoryTimeFull,
  getTimeline,
  getTimelineCalendar,
  getTimelineCoverage,
  moveTimelineItem,
  parseStoryTimeInput,
  setSceneCharacters,
  setScenePlotline,
  type UUID,
  updateScene,
  updateTimelineEvent,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 10 integration against the real native driver: the timeline's lanes, the drag's
 * one-row write, the no-time tray and the "two places at once" warning — plus the two budgets
 * the M2 gate asks for (spec §5.1 view switch ≤ 100 ms, scene move commit ≤ 30 ms) measured on
 * a reference-scale project.
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
let tor: UUID;
let harbour: UUID;
let ridge: UUID;
let plotlineId: UUID;
let sceneA: UUID;
let sceneB: UUID;
let sceneC: UUID;
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

/** Story time helper: "1247-03-12" → seconds. */
function at(text: string): number {
  const seconds = parseStoryTimeInput(
    { kind: "gregorian", eraLabel: "AD", monthNames: null, daysPerMonth: null, hoursPerDay: 24 },
    text,
  );
  if (seconds === null) throw new Error(`bad test date: ${text}`);
  return seconds;
}

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice10-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (await run(createProject, { title: "Slice 10" })).projectId;

  mina = (await run(createCharacter, { projectId, name: "Mina Voss", role: "protagonist" }))
    .characterId;
  tor = (await run(createCharacter, { projectId, name: "Tor Halden", role: "major" })).characterId;
  harbour = (await run(createLoreEntry, { projectId, name: "Harbour", kind: "location" })).entryId;
  ridge = (await run(createLoreEntry, { projectId, name: "The ridge", kind: "location" })).entryId;
  plotlineId = (await run(createPlotline, { projectId, name: "The debt" })).plotlineId;

  sceneA = (await run(createScene, { projectId, title: "The ferry" })).sceneId;
  sceneB = (await run(createScene, { projectId, title: "The ridge road" })).sceneId;
  sceneC = (await run(createScene, { projectId, title: "Much later" })).sceneId;
  await run(setSceneCharacters, { projectId, sceneId: sceneA, characterIds: [mina, tor] });
  await run(setSceneCharacters, { projectId, sceneId: sceneB, characterIds: [mina] });
  // The location column drives the conflict check; `setSceneLore` is the "lore touched" list.
  await run(updateScene, { projectId, sceneId: sceneA, patch: { locationId: harbour } });
  await run(updateScene, { projectId, sceneId: sceneB, patch: { locationId: ridge } });
  await run(setScenePlotline, {
    projectId,
    sceneId: sceneA,
    plotlineId,
    attached: true,
  });
});

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("events", () => {
  it("creates a world event and shows it in the world lane", async () => {
    const { eventId } = await run(createTimelineEvent, {
      projectId,
      title: "The comet falls",
      lane: "world",
      storyTime: at("1247-03-12 20:00"),
      storyTimeLabel: "the night of the storm",
    });
    const timeline = await getTimeline(driver, projectId);
    const world = timeline.lanes.find((lane) => lane.kind === "world");
    const event = world?.items.find((item) => item.id === eventId);
    expect(event?.kind).toBe("event");
    expect(event?.storyTimeLabel).toBe("the night of the storm");
    expect(timeline.range?.start).toBeLessThanOrEqual(at("1247-03-12 20:00"));
    expect(formatStoryTimeFull(timeline.calendar, at("1247-03-12"))).toBe("12 Mar 1247 AD");
  });

  it("refuses a lane without its owner, and an end before the start", async () => {
    await expect(
      run(createTimelineEvent, {
        projectId,
        title: "Nameless",
        lane: "character",
        storyTime: at("1247"),
      }),
    ).rejects.toThrow(/needs a character/);
    await expect(
      run(createTimelineEvent, {
        projectId,
        title: "Backwards",
        lane: "plot",
        storyTime: at("1247"),
      }),
    ).rejects.toThrow(/needs a plotline/);
    await expect(
      run(createTimelineEvent, {
        projectId,
        title: "Backwards",
        lane: "world",
        storyTime: at("1247-06"),
        storyTimeEnd: at("1247-03"),
      }),
    ).rejects.toThrow(/cannot be before/);
  });

  it("puts a character event in that character's lane and a plot event in the plotline's", async () => {
    await run(createTimelineEvent, {
      projectId,
      title: "Mina learns the truth",
      lane: "character",
      characterId: mina,
      storyTime: at("1247-04-01"),
    });
    await run(createTimelineEvent, {
      projectId,
      title: "The debt is called in",
      lane: "plot",
      plotlineId,
      storyTime: at("1247-05-01"),
    });
    const timeline = await getTimeline(driver, projectId);
    const minaLane = timeline.lanes.find((lane) => lane.characterId === mina);
    const plotLane = timeline.lanes.find((lane) => lane.plotlineId === plotlineId);
    expect(minaLane?.items.some((item) => item.title === "Mina learns the truth")).toBe(true);
    expect(plotLane?.items.some((item) => item.title === "The debt is called in")).toBe(true);
    // The character lane also carries the scenes Mina is in, once they have a story time.
    expect(minaLane?.label).toBe("Mina Voss");
  });

  it("updates and soft-deletes an event", async () => {
    const { eventId } = await run(createTimelineEvent, {
      projectId,
      title: "Draft event",
      lane: "world",
      storyTime: at("1248"),
    });
    await run(updateTimelineEvent, {
      projectId,
      eventId,
      patch: {
        title: "Renamed event",
        storyTime: at("1248-06"),
        color: "#5ad1a5",
        description: "notes",
      },
    });
    let timeline = await getTimeline(driver, projectId);
    let event = timeline.lanes.flatMap((lane) => lane.items).find((item) => item.id === eventId);
    expect(event?.title).toBe("Renamed event");
    expect(event?.kind === "event" ? event.color : null).toBe("#5ad1a5");
    expect(event?.storyTime).toBe(at("1248-06"));

    await run(deleteTimelineEvent, { projectId, eventId });
    timeline = await getTimeline(driver, projectId);
    event = timeline.lanes.flatMap((lane) => lane.items).find((item) => item.id === eventId);
    expect(event).toBeUndefined();
  });

  it("keeps an event's duration when it is dragged", async () => {
    const { eventId } = await run(createTimelineEvent, {
      projectId,
      title: "A long winter",
      lane: "world",
      storyTime: at("1249-01"),
      storyTimeEnd: at("1249-03"),
    });
    await run(moveTimelineItem, {
      projectId,
      kind: "event",
      id: eventId,
      storyTime: at("1250-01"),
    });
    const timeline = await getTimeline(driver, projectId);
    const event = timeline.lanes.flatMap((lane) => lane.items).find((item) => item.id === eventId);
    expect(event?.storyTime).toBe(at("1250-01"));
    expect(event?.storyTimeEnd).toBe(at("1250-03"));
  });
});

describe("scenes on the timeline", () => {
  it("moves a scene in one row and places it in its lanes", async () => {
    await run(moveTimelineItem, {
      projectId,
      kind: "scene",
      id: sceneA,
      storyTime: at("1247-03-12 18:00"),
    });
    await run(moveTimelineItem, {
      projectId,
      kind: "scene",
      id: sceneB,
      storyTime: at("1247-03-13 09:00"),
    });
    const timeline = await getTimeline(driver, projectId);
    const minaLane = timeline.lanes.find((lane) => lane.characterId === mina);
    const titles = (minaLane?.items ?? []).map((item) => item.title);
    expect(titles).toContain("The ferry");
    expect(titles).toContain("The ridge road");
    const plotLane = timeline.lanes.find((lane) => lane.plotlineId === plotlineId);
    const plotTitles = (plotLane?.items ?? []).map((item) => item.title);
    expect(plotTitles).toContain("The ferry");
    expect(plotTitles).toContain("The debt is called in");
    // The no-time tray still holds the third scene.
    expect(timeline.noTime.map((scene) => scene.title)).toEqual(["Much later"]);
  });

  it("warns when a character is in two places at once", async () => {
    // Mina is in the ferry (harbour) at 18:00 and on the ridge at 09:00 the next day — the
    // nominal one-hour windows do not overlap, so no warning yet.
    expect(await detectTimelineConflicts(driver, projectId)).toHaveLength(0);
    // Move the ridge scene onto the same evening: same character, different place, overlapping.
    await run(moveTimelineItem, {
      projectId,
      kind: "scene",
      id: sceneB,
      storyTime: at("1247-03-12 18:30"),
    });
    const conflicts = await detectTimelineConflicts(driver, projectId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.characterName).toBe("Mina Voss");
    expect(conflicts[0]?.sceneALocation).toBe("Harbour");
    expect(conflicts[0]?.sceneBLocation).toBe("The ridge");
    // The same scene moved far away clears it again.
    await run(moveTimelineItem, {
      projectId,
      kind: "scene",
      id: sceneB,
      storyTime: at("1247-04-01"),
    });
    expect(await detectTimelineConflicts(driver, projectId)).toHaveLength(0);
  });

  it("drops a trashed scene out of the lanes, the tray and the conflicts", async () => {
    await run(deleteScene, { projectId, sceneId: sceneC });
    const timeline = await getTimeline(driver, projectId);
    expect(timeline.noTime.map((scene) => scene.title)).not.toContain("Much later");
    const coverage = await getTimelineCoverage(driver, projectId);
    expect(coverage.placed).toBe(2);
    expect(coverage.unplaced).toBe(0);
  });

  it("reads the project's own calendar for its labels", async () => {
    await driver.query(
      "UPDATE project SET settings = json_set(settings, '$.timelineCalendar.eraLabel', 'TA') WHERE id = ?",
      [projectId],
    );
    const calendar = await getTimelineCalendar(driver, projectId);
    expect(calendar.eraLabel).toBe("TA");
    const timeline = await getTimeline(driver, projectId);
    expect(formatStoryTimeFull(timeline.calendar, at("1247-03-12"))).toContain("1247 TA");
    await driver.query(
      "UPDATE project SET settings = json_set(settings, '$.timelineCalendar.eraLabel', 'AD') WHERE id = ?",
      [projectId],
    );
  });
});

describe("M2 gate budgets", () => {
  it("reads the whole timeline of a reference-scale project in one pass, inside 100 ms", async () => {
    // 150 scenes across 60 characters and 40 events — the spec's reference project shape.
    const characterIds: UUID[] = [];
    for (let index = 0; index < 60; index += 1) {
      characterIds.push(
        (await run(createCharacter, { projectId, name: `Extra ${index}`, role: "minor" }))
          .characterId,
      );
    }
    for (let index = 0; index < 150; index += 1) {
      const created = await run(createScene, { projectId, title: `Scene ${index}` });
      await run(moveTimelineItem, {
        projectId,
        kind: "scene",
        id: created.sceneId,
        storyTime: at("1247-01-01") + index * 86400,
      });
      const cast = characterIds[index % characterIds.length];
      if (cast) {
        await run(setSceneCharacters, {
          projectId,
          sceneId: created.sceneId,
          characterIds: [cast],
        });
      }
    }
    for (let index = 0; index < 40; index += 1) {
      await run(createTimelineEvent, {
        projectId,
        title: `Event ${index}`,
        lane: "world",
        storyTime: at("1247-01-01") + index * 3 * 86400,
      });
    }

    const samples: number[] = [];
    let timeline = await getTimeline(driver, projectId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const started = performance.now();
      timeline = await getTimeline(driver, projectId);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    console.log(
      `timeline read: median ${median.toFixed(1)} ms (min ${(samples[0] ?? 0).toFixed(1)}, max ${(samples[samples.length - 1] ?? 0).toFixed(1)})`,
    );
    expect(timeline.lanes.length).toBeGreaterThan(60);
    expect(timeline.lanes.flatMap((lane) => lane.items).length).toBeGreaterThan(190);
    // Budget: spec §5.1's view switch (≤ 100 ms to first content) with the harness's own
    // round-trip overhead included.
    expect(median).toBeLessThan(100);

    const dragSamples: number[] = [];
    const victim = timeline.lanes
      .find((lane) => lane.kind === "character")
      ?.items.find((item) => item.kind === "scene");
    for (let attempt = 0; attempt < 5 && victim; attempt += 1) {
      const started = performance.now();
      await run(moveTimelineItem, {
        projectId,
        kind: "scene",
        id: victim.id,
        storyTime: at("1248-01-01") + attempt * 3600,
      });
      dragSamples.push(performance.now() - started);
    }
    dragSamples.sort((a, b) => a - b);
    const dragMedian = dragSamples[Math.floor(dragSamples.length / 2)] ?? 0;
    console.log(`scene drag commit: median ${dragMedian.toFixed(1)} ms`);
    // Budget: spec §5.1's scene move commit (≤ 30 ms drop → persisted).
    expect(dragMedian).toBeLessThan(30);
  });
});
