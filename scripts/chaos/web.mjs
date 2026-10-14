#!/usr/bin/env node
// Web chaos harness (docs/PLAN.md slice 5, spec §5.3 durability): drives the wasm/OPFS
// storage through the dev-only `window.__starlineDev` hook — random write batches, each cut
// short by a hard page reload mid-flight (a real crash: the JS context dies while the worker
// may be mid-transaction) — then reopens the library and asserts:
//   · the app reopens and the recovery banner fired (crash detection works),
//   · the integrity check did NOT fail,
//   · the last committed transaction is consistent (counts, FK sanity, order keys).
// Usage: node scripts/chaos/web.mjs [batches]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const batches = Number(process.argv[2] ?? 5);
const shotDir = join(tmpdir(), "starline-shots");
mkdirSync(shotDir, { recursive: true });
const url = "http://localhost:5186/";

const viteBin = join(repoRoot, "apps", "web", "node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteBin, "--port", "5186", "--strictPort"], {
  cwd: join(repoRoot, "apps", "web"),
  stdio: "ignore",
});
let up = false;
for (let attempt = 0; attempt < 120 && !up; attempt++) {
  try {
    up = (await fetch(url)).ok;
  } catch {
    // not up yet
  }
  if (!up) await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!up) throw new Error("dev server did not come up");

/** Runs `count` random commands in the page; resolves only when all settle. */
function randomOpsScript() {
  return async (n) => {
    const dev = window.__starlineDev;
    if (!dev) throw new Error("dev hook missing");
    const session = dev.session();
    if (!session) throw new Error("no session");
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const projectId = projects[0]?.id;
    if (!projectId) throw new Error("no project");
    const scenes = await session.driver.query(
      "SELECT id, chapter_id, order_key FROM scene WHERE project_id = ? AND deleted_at IS NULL LIMIT 40",
      [projectId],
    );
    const chapters = await session.driver.query(
      "SELECT id FROM chapter WHERE project_id = ? AND deleted_at IS NULL LIMIT 10",
      [projectId],
    );
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      const scene = scenes[Math.floor(Math.random() * scenes.length)];
      if (roll < 0.25 || !scene) {
        await dev.run("createScene", {
          projectId,
          title: `Chaos ${Math.floor(Math.random() * 1e6)}`,
        });
      } else if (roll < 0.4) {
        await dev.run("updateScene", {
          projectId,
          sceneId: scene.id,
          patch: { objective: `Objective ${Math.floor(Math.random() * 1e6)}` },
        });
      } else if (roll < 0.55) {
        await dev.run("createChapter", {
          projectId,
          title: `Chaos chapter ${Math.floor(Math.random() * 1e6)}`,
        });
      } else if (roll < 0.65) {
        await dev.run("createCharacter", {
          projectId,
          name: `Chaos ${Math.floor(Math.random() * 1e6)}`,
        });
      } else if (roll < 0.75) {
        await dev.run("deleteScene", { projectId, sceneId: scene.id });
      } else if (roll < 0.85) {
        const chapter = chapters[Math.floor(Math.random() * chapters.length)];
        await dev.run("moveScene", {
          projectId,
          sceneId: scene.id,
          chapterId: chapter?.id ?? null,
          beforeSceneId: null,
        });
      } else if (roll < 0.93) {
        await dev.run("restoreEntity", {
          projectId,
          entityType: "scene",
          entityId: scene.id,
        });
      } else {
        await dev.run("saveStepContent", {
          projectId,
          step: 2,
          content: {
            setup: `Chaos setup ${Math.floor(Math.random() * 1e6)}`,
            disaster1: `Chaos disaster ${Math.floor(Math.random() * 1e6)}`,
            disaster2: `Chaos disaster ${Math.floor(Math.random() * 1e6)}`,
            disaster3: `Chaos disaster ${Math.floor(Math.random() * 1e6)}`,
            ending: `Chaos ending ${Math.floor(Math.random() * 1e6)}`,
          },
        });
      }
    }
    return n;
  };
}

/** Direct-driver consistency probe: integrity, FK sanity, order keys, counts. */
function consistencyScript() {
  return async () => {
    const dev = window.__starlineDev;
    const session = dev.session();
    const integrity = await session.driver.integrityCheck();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const projectId = projects[0]?.id;
    const [orphanChapters] = await session.driver.query(
      `SELECT COUNT(*) AS n FROM scene s WHERE s.project_id = ?
         AND s.deleted_at IS NULL AND s.chapter_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM chapter c WHERE c.id = s.chapter_id AND c.deleted_at IS NULL)`,
      [projectId],
    );
    const [emptyKeys] = await session.driver.query(
      `SELECT COUNT(*) AS n FROM scene WHERE project_id = ? AND (order_key IS NULL OR order_key = '')`,
      [projectId],
    );
    const [sceneCount] = await session.driver.query(
      "SELECT COUNT(*) AS n FROM scene WHERE project_id = ? AND deleted_at IS NULL",
      [projectId],
    );
    const [revision] = await session.driver.query("SELECT value FROM meta WHERE key = 'revision'");
    return {
      integrityOk: integrity.ok,
      integrityMessages: integrity.messages,
      orphanChapters: orphanChapters?.n ?? 0,
      emptyKeys: emptyKeys?.n ?? 0,
      sceneCount: sceneCount?.n ?? 0,
      revision: revision?.value ?? null,
    };
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: "en-US" });
try {
  // 1. Create the library + story, then seed a scene pool through the hook.
  await page.goto(url);
  await page.getByPlaceholder("My Novel").waitFor();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByPlaceholder("My Novel").waitFor();
  await page.getByPlaceholder("My Novel").fill("Chaos Web");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByPlaceholder("Name your story").waitFor({ timeout: 60_000 });
  // The first-run wizard (S37) overlays the create form.
  const wizard = page.getByTestId("sl-onboarding");
  if ((await wizard.count()) > 0) {
    await page.getByTestId("sl-onboarding-skip").click();
    await wizard.waitFor({ state: "hidden", timeout: 8000 });
  }
  await page.getByPlaceholder("Name your story").fill("Chaos Story");
  await page.getByRole("button", { name: "Create story" }).click();
  await page.getByText("0 of 9 steps complete").waitFor();
  await page.evaluate(randomOpsScript(12), 12);
  console.log("seed: 12 random ops applied");

  // 2. Crash batches: fire a batch, kill the page mid-flight, reopen, verify.
  for (let batch = 1; batch <= batches; batch++) {
    const pending = page.evaluate(randomOpsScript(25), 25).catch(() => undefined);
    await page.waitForTimeout(180 + Math.floor(Math.random() * 250));
    await page.reload({ waitUntil: "commit" });
    await pending;

    await page.getByText("Your libraries").waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Open" }).click();
    await page.getByRole("link", { name: "Plan" }).click();
    await page.getByText(/steps complete/).waitFor({ timeout: 60_000 });

    // Crash detection: the previous session never wrote its clean marker, so the banner must
    // fire — and it must be the recovery banner, never the integrity-failure one.
    await page.getByText(/Recovered from an unexpected shutdown/).waitFor({ timeout: 30_000 });
    const bodyText = await page.innerText("body");
    if (bodyText.includes("Integrity check failed")) {
      throw new Error(`batch ${batch}: integrity failure banner after crash`);
    }
    await page.getByRole("button", { name: "Dismiss" }).click();

    const state = await page.evaluate(consistencyScript());
    if (!state.integrityOk) {
      throw new Error(
        `batch ${batch}: integrity_check failed: ${state.integrityMessages.join("; ")}`,
      );
    }
    if (state.orphanChapters !== 0) {
      throw new Error(`batch ${batch}: ${state.orphanChapters} scenes point at missing chapters`);
    }
    if (state.emptyKeys !== 0) {
      throw new Error(`batch ${batch}: ${state.emptyKeys} scenes without an order key`);
    }
    console.log(
      `batch ${batch}: crash ok · integrity ok · ${state.sceneCount} scenes · revision ${state.revision}`,
    );
  }

  // 3. Final reopen with a clean close: no crash banner may linger.
  await page.getByRole("button", { name: "Close library" }).click();
  await page.getByText("Your libraries").waitFor();
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByText(/steps complete/).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const alerts = await page.getByRole("alert").count();
  if (alerts !== 0) {
    const text = await page.getByRole("alert").first().innerText();
    throw new Error(`clean reopen still shows a banner: ${text}`);
  }
  await page.screenshot({ path: join(shotDir, "chaos-web.png"), fullPage: true });

  console.log("WEB-CHAOS OK");
} catch (cause) {
  await page
    .screenshot({ path: join(shotDir, "chaos-failure.png"), fullPage: true })
    .catch(() => {});
  throw cause;
} finally {
  await browser.close();
  server.kill();
}
