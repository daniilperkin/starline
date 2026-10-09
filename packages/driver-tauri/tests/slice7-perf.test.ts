import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BACKLINK_BUDGET_MS,
  ChangeBus,
  createProject,
  executeCommand,
  listBacklinks,
  SEARCH_BUDGET_MS,
  type SearchRunner,
  searchProject,
  type UUID,
} from "@starline/core";
import { runMigrations } from "@starline/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

/**
 * Slice 7 exit criterion (spec §5.1, PLAN slice 7): backlink ≤ 10 ms and search ≤ 30 ms on the
 * reference project — a 120k-word novel: 150 scenes, 60 characters, 400 lore entries, 300 notes,
 * 2 000 mentions.
 *
 * How the number is taken: the SQL that `searchProject` / `listBacklinks` actually issue is
 * captured with a recording runner, then replayed by the storage process's `bench` op, which
 * times prepare + step + row materialisation *inside* that process. That is the cost both
 * shipping drivers pay (rusqlite in-process in Tauri, sqlite-wasm in the web worker); the NDJSON
 * pipe of this harness adds its own per-round-trip latency, which no shipping build has, so the
 * end-to-end figure is printed for context but not asserted.
 */
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
/** Perf runs against the optimized binary — a debug build measures the compiler, not the app. */
const binPath = join(repoRoot, "target", "release", binName);

const SCENES = 150;
const CHARACTERS = 60;
const LORE = 400;
const NOTES = 300;
const MENTIONS = 2000;

let driver: TauriStorageDriver;
let transport: StdioTransport;
let dir: string;
let projectId: UUID;
let characterTargetIds: UUID[] = [];
const bus = new ChangeBus();

interface BenchResult {
  rows: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/** Deterministic PRNG so a failing run can be reproduced exactly. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "ember",
  "harbour",
  "storm",
  "salt",
  "glass",
  "coast",
  "winter",
  "lantern",
  "vow",
  "river",
  "cinder",
  "marsh",
  "throne",
  "silver",
  "crown",
  "mist",
  "iron",
  "hollow",
  "beacon",
  "tide",
  "shadow",
  "frost",
  "compass",
  "kestrel",
  "brine",
  "quill",
  "vellum",
  "ash",
  "meridian",
  "gale",
];
const FIRST = [
  "Mira",
  "Tor",
  "Kestrel",
  "Ada",
  "Brann",
  "Cato",
  "Dara",
  "Elias",
  "Fenn",
  "Greta",
  "Hale",
  "Ines",
  "Joss",
  "Kara",
  "Lior",
  "Mabel",
  "Nero",
  "Orla",
  "Pike",
  "Quinn",
];
const LAST = ["Holt", "Verrin", "Ash", "Marsh", "Quill", "Ember", "Frost", "Wren", "Vale", "Bray"];

function ensureCliBuilt(): void {
  if (existsSync(binPath) && process.env.STARLINE_REBUILD_CLI !== "1") return;
  execFileSync("node", [join(repoRoot, "scripts", "cargo.mjs"), "build", "--release"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

/** Builds the whole reference dataset as one multi-statement script (triggers fill FTS). */
function seedScript(): { sql: string; loreIds: string[]; characterIds: string[] } {
  const random = mulberry32(20261009);
  const now = Date.now();
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const words = (count: number) =>
    Array.from({ length: count }, () => pick(WORDS))
      .join(" ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const statements: string[] = [];
  const loreIds: string[] = [];
  const characterIds: string[] = [];
  const sceneIds: string[] = [];
  const noteIds: string[] = [];
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

  const kinds = [
    "location",
    "faction",
    "magic_system",
    "history_event",
    "geography",
    "culture",
    "species",
    "item",
    "language",
    "technology",
  ];

  for (let i = 0; i < CHARACTERS; i++) {
    const id = `char-${String(i).padStart(3, "0")}`;
    characterIds.push(id);
    const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]}`;
    statements.push(
      `INSERT INTO character (id, project_id, name, role, color, one_line, storyline_text, order_key, created_at, updated_at)
       VALUES (${quote(id)}, ${quote(projectId)}, ${quote(name)}, 'supporting', '#f0b429',
               ${quote(`A ${pick(WORDS)} of the ${pick(WORDS)}.`)}, ${quote(words(40))},
               ${quote(`a${String(i).padStart(4, "0")}`)}, ${now}, ${now});`,
    );
  }

  for (let i = 0; i < LORE; i++) {
    const id = `lore-${String(i).padStart(3, "0")}`;
    loreIds.push(id);
    const kind = kinds[i % kinds.length] as string;
    statements.push(
      `INSERT INTO lore_entry (id, project_id, kind, name, summary, body_text, order_key, created_at, updated_at)
       VALUES (${quote(id)}, ${quote(projectId)}, ${quote(kind)}, ${quote(`The ${pick(WORDS)} ${i}`)},
               ${quote(`A ${pick(WORDS)} place of ${pick(WORDS)}.`)}, ${quote(words(60))},
               ${quote(`a${String(i).padStart(4, "0")}`)}, ${now}, ${now});`,
    );
  }

  for (let i = 0; i < SCENES; i++) {
    const id = `scene-${String(i).padStart(3, "0")}`;
    sceneIds.push(id);
    statements.push(
      `INSERT INTO scene (id, project_id, title, synopsis_text, order_key, created_at, updated_at)
       VALUES (${quote(id)}, ${quote(projectId)}, ${quote(`Scene ${i + 1}`)}, ${quote(words(45))},
               ${quote(`a${String(i).padStart(4, "0")}`)}, ${now}, ${now});`,
    );
  }

  for (let i = 0; i < NOTES; i++) {
    const id = `note-${String(i).padStart(3, "0")}`;
    noteIds.push(id);
    statements.push(
      `INSERT INTO idea_note (id, project_id, title, body_text, order_key, created_at, updated_at)
       VALUES (${quote(id)}, ${quote(projectId)}, ${quote(`Note ${i + 1} ${pick(WORDS)}`)}, ${quote(words(30))},
               ${quote(`a${String(i).padStart(4, "0")}`)}, ${now}, ${now});`,
    );
  }

  // 2 000 mentions with a realistic skew: the first 40 targets are the "main cast" and take most
  // of the traffic, the rest are long tail. Sources are scenes, lore bodies and storylines.
  const popularTargets = [...loreIds.slice(0, 20), ...characterIds.slice(0, 20)];
  const allTargets = [...loreIds, ...characterIds];
  const sourceKinds = ["scene", "lore", "character"] as const;
  const seen = new Set<string>();
  for (let i = 0; i < MENTIONS; i++) {
    const targetId = i % 3 === 0 ? pick(popularTargets) : pick(allTargets);
    const targetType = targetId.startsWith("char") ? "character" : "lore";
    const sourceKind = pick(sourceKinds);
    const sourceId =
      sourceKind === "scene"
        ? pick(sceneIds)
        : sourceKind === "lore"
          ? pick(loreIds)
          : pick(characterIds);
    const field =
      sourceKind === "scene" ? "synopsis" : sourceKind === "lore" ? "body" : "storyline";
    const key = `${sourceKind}:${sourceId}:${field}:${targetType}:${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const count = 1 + Math.floor(random() * 3);
    statements.push(
      `INSERT INTO mention (source_type, source_id, field, target_type, target_id, count)
       VALUES (${quote(sourceKind)}, ${quote(sourceId)}, ${quote(field)}, ${quote(targetType)}, ${quote(targetId)}, ${count});`,
    );
  }

  return { sql: statements.join("\n"), loreIds, characterIds };
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/**
 * A runner that records the statements a core read issues instead of executing them, returning
 * one canned row per shape so the read keeps going through its later steps.
 */
function recorder(): { runner: SearchRunner; statements: { sql: string; params: unknown[] }[] } {
  const statements: { sql: string; params: unknown[] }[] = [];
  const runner: SearchRunner = {
    async query<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      statements.push({ sql, params: [...(params ?? [])] });
      if (sql.includes("AS detail")) {
        return [
          { entity_type: "lore", entity_id: "lore-000", detail: "location" },
        ] as unknown as T[];
      }
      if (sql.includes("FROM mention")) {
        return [
          { source_type: "lore", source_id: "lore-001", field: "body", count: 2 },
        ] as unknown as T[];
      }
      if (sql.includes("FROM scene s")) {
        return [{ id: "scene-000", chapter_title: null }] as unknown as T[];
      }
      if (sql.includes("AS body_snippet")) {
        return [
          {
            entity_type: "lore",
            entity_id: "lore-000",
            title: "The Ember 0",
            body_snippet: "… ember …",
            score: -1,
          },
        ] as unknown as T[];
      }
      return [{ name: "The Ember 0", aliases: null }] as unknown as T[];
    },
  };
  return { runner, statements };
}

async function bench(
  statements: { sql: string; params: unknown[] }[],
  runs = 25,
): Promise<BenchResult[]> {
  const response = await transport.request<{ results: BenchResult[] }>("bench", {
    statements,
    runs,
  });
  return response.results;
}

function totalP95(results: readonly BenchResult[]): number {
  return Math.round(results.reduce((sum, result) => sum + result.p95Ms, 0) * 100) / 100;
}

beforeAll(async () => {
  ensureCliBuilt();
  dir = await mkdtemp(join(tmpdir(), "starline-slice7-perf-"));
  transport = new StdioTransport({ command: binPath, env: { STARLINE_LOCK_STALE_MS: "500" } });
  driver = new TauriStorageDriver(transport, { watchIntervalMs: 0 });
  await driver.open({ path: join(dir, "project.starline"), create: true, readOnly: false });
  await runMigrations(driver);
  projectId = (
    await executeCommand({ transaction: (fn) => driver.transaction(fn) }, bus, createProject, {
      title: "Reference project",
    })
  ).projectId;

  const seeded = seedScript();
  characterTargetIds = seeded.characterIds.map((id) => id as UUID);
  await driver.transaction((tx) => tx.execScript(seeded.sql));

  const counts = await driver.query<{ scenes: number; lore: number; mentions: number }>(
    `SELECT (SELECT COUNT(*) FROM scene) AS scenes,
            (SELECT COUNT(*) FROM lore_entry) AS lore,
            (SELECT COUNT(*) FROM mention) AS mentions`,
  );
  console.log(
    `  reference dataset: ${counts[0]?.scenes} scenes, ${counts[0]?.lore} lore, ${counts[0]?.mentions} mentions`,
  );
}, 300_000);

afterAll(async () => {
  try {
    await driver.close();
  } catch {
    // already closed
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("spec §5.1 budgets on the reference project", () => {
  it("backlink read stays within 10 ms (p95, in-process SQL)", async () => {
    const busiest = characterTargetIds[0] as UUID;
    const before = await listBacklinks(driver, projectId, "character", busiest);
    const capture = recorder();
    await listBacklinks(capture.runner, projectId, "character", busiest);
    const results = await bench(capture.statements);
    const p95 = totalP95(results);

    const samples: number[] = [];
    for (let run = 0; run < 20; run++) {
      const started = Date.now();
      await listBacklinks(driver, projectId, "character", busiest);
      samples.push(Date.now() - started);
    }
    console.log(
      `  backlinks: ${results.length} statements · in-process p95 ${p95} ms (${results
        .map((result) => result.p95Ms.toFixed(2))
        .join(
          " + ",
        )}) · busiest target ${before.sources.length} sources · harness e2e p95 ${percentile(samples, 95)} ms`,
    );
    expect(p95).toBeLessThanOrEqual(BACKLINK_BUDGET_MS);
  }, 120_000);

  it("full-text search stays within 30 ms (p95, in-process SQL)", async () => {
    const capture = recorder();
    await searchProject(capture.runner, projectId, "ember");
    const results = await bench(capture.statements);
    const p95 = totalP95(results);

    const queries = [
      "ember",
      "harbour",
      "storm",
      "salt",
      "glass",
      "winter",
      "lantern",
      "vow",
      "river",
      "cinder",
      "marsh",
      "throne",
      "silver",
      "crown",
      "mist",
      "iron",
      "beacon",
      "tide",
      "shad",
      "frost",
    ];
    const samples: number[] = [];
    let hits = 0;
    for (const query of queries) {
      const started = Date.now();
      const found = await searchProject(driver, projectId, query);
      samples.push(Date.now() - started);
      hits += found.total;
    }
    console.log(
      `  search: ${results.length} statements · in-process p95 ${p95} ms (${results
        .map((result) => result.p95Ms.toFixed(2))
        .join(
          " + ",
        )}) · harness e2e p50 ${percentile(samples, 50)} ms / p95 ${percentile(samples, 95)} ms (${hits} hits over ${queries.length} queries)`,
    );
    expect(p95).toBeLessThanOrEqual(SEARCH_BUDGET_MS);
  }, 120_000);

  it("keeps the mention mirror populated", async () => {
    const rows = await driver.query<{ n: number }>("SELECT COUNT(*) AS n FROM mention");
    expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(1000);
  });
});
