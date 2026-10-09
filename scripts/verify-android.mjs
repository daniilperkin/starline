#!/usr/bin/env node
// Scripted emulator flow for the Android APK (docs/PLAN.md §6 gate). Expects a booted
// emulator or attached device, installs the APK fresh, then drives the Capacitor WebView
// over CDP (Playwright connectOverCDP): create library → create story → complete steps 1–4
// (character card, step-4 seed trigger, rich-text editors) → step-8 paste import on-device →
// Scenes tab + scene-sheet round-trip → slice-5 on-device: step 9 accordion + copy trigger,
// dashboard cards + manual snapshot, trash round-trip, undo toast, long-press drag reorder →
// hardware back navigation → minimise at the root → cold relaunch keeps the plan.
// Usage: node scripts/verify-android.mjs [apk-path]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = join(tmpdir(), "starline-shots");
mkdirSync(shotDir, { recursive: true });
const apk = process.argv[2] ?? join(repoRoot, "artifacts", "starline-debug.apk");
const ADB = process.env.ADB ?? "C:/Users/danyo/AppData/Local/Android/Sdk/platform-tools/adb.exe";
const PACKAGE = "app.starline";

if (!existsSync(apk)) {
  throw new Error(`APK not found: ${apk} — build it first (docs/PLAN.md, "APK build recipe")`);
}

function adb(args) {
  return execFileSync(ADB, args, { stdio: ["ignore", "pipe", "ignore"] }).toString();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Emulator flake guard: the software-rendered device occasionally swallows a tap when React
 * is mid-re-render (rich-text editors mounting). Click "Mark step complete" and retry until
 * the expected plan text appears.
 */
async function completeStepAndWait(page, expectedText) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const button = page.getByRole("button", { name: "Mark step complete" });
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 10_000 }).catch(() => undefined);
    }
    try {
      await page.getByText(expectedText).waitFor({ timeout: 8000 });
      return;
    } catch {
      // the tap was swallowed — try again
    }
  }
  await page.getByText(expectedText).waitFor({ timeout: 30_000 });
}

async function forwardDevtools() {
  let socket = null;
  for (let attempt = 0; attempt < 20 && socket === null; attempt++) {
    const match = adb(["shell", "cat", "/proc/net/unix"]).match(/webview_devtools_remote_(\d+)/);
    socket = match ? match[1] : null;
    if (socket === null) await sleep(500);
  }
  if (socket === null) throw new Error("webview devtools socket not found");
  adb(["forward", "tcp:9222", `localabstract:webview_devtools_remote_${socket}`]);
}

async function connect() {
  await forwardDevtools();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const browser = await chromium.connectOverCDP("http://localhost:9222");
      const page = browser
        .contexts()[0]
        ?.pages()
        .find((candidate) => candidate.url().startsWith("https://localhost"));
      if (page) return { browser, page };
      await browser.close().catch(() => undefined);
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error("could not attach to the StarLine WebView");
}

adb(["wait-for-device"]);
// Fresh data for every run. `uninstall` alone is not enough when the app is still foregrounded:
// it can fail silently and `install -r` then reuses the old WebView OPFS — including a sahpool
// that earlier leaks already filled, which masks the bug under test. Force-stop + `pm clear`
// guarantees an empty pool.
try {
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb(["shell", "pm", "clear", PACKAGE]);
} catch {
  // not installed — fine
}
try {
  adb(["uninstall", PACKAGE]);
} catch {
  // not installed — fine
}
adb(["install", "-r", apk]);
adb(["shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`]);
await sleep(3000);

let { browser, page } = await connect();
// Console + page errors land in the QA log — the software-rendered WebView is slow and silent
// failures are otherwise painful to diagnose from a screenshot.
page.on("console", (message) => {
  if (message.type() === "error") console.log(`[webview] ${message.text().slice(0, 300)}`);
});
page.on("pageerror", (error) => {
  console.log(`[webview:pageerror] ${String(error).slice(0, 300)}`);
});
try {
  // 1. Create the library, then the story. Cold boots on the software renderer are slow:
  // wasm compile + migrations + the first open-snapshot all land here, so budgets are generous.
  await page.getByPlaceholder("My Novel").waitFor({ timeout: 60000 });
  await page.getByPlaceholder("My Novel").fill("Emu Demo");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByPlaceholder("Name your story").waitFor({ timeout: 180000 });
  await page.getByPlaceholder("Name your story").fill("Emulator Story");
  await page.getByRole("button", { name: "Create story" }).click();
  await page.getByText("0 of 9 steps complete").waitFor({ timeout: 60000 });
  console.log("PASS  library + story created");

  // sahpool diagnostics (printed, not asserted). The pool's own numbers do NOT map to free
  // slots — a clean install has reported capacity 3 / files 1 while the app kept writing, and
  // capacity 16 / files 1 in another run — so the health signal is the write the journey does
  // next (step 1's save, a real transaction that needs a journal file). A pool directory left
  // over from a previous install is what makes that write fail as "SAH pool is full. Cannot
  // create file /X.starline-journal", so if a later step times out, check these numbers and the
  // webview console lines printed above before anything else.
  const pool = await page.evaluate(() => window.__starlineDev.poolStats());
  console.log(
    `  sahpool: capacity ${pool.capacity}, files ${pool.fileCount} (${pool.files.join(", ")})`,
  );

  // 2. Step 1: write the sentence and complete it.
  await page.locator(".sl-step-row").filter({ hasText: "One sentence" }).click();
  await page
    .getByLabel("One sentence")
    .fill(
      "A grieving cartographer must map a shifting island before it sinks and takes her sister with it",
    );
  await page.getByText("17 / 25 words").waitFor();
  await completeStepAndWait(page, "1 of 9 steps complete");
  console.log("PASS  step 1 completed");

  // 2b. Step 2: the five sentences.
  await page.locator(".sl-step-row").filter({ hasText: "One paragraph" }).click();
  await page.getByLabel("Setup").fill("A quiet harbour town thrives on the trade winds.");
  await page.getByLabel("Disaster 1").fill("The winds vanish and the fleet is stranded.");
  await page.getByLabel("Disaster 2").fill("A rival fleet arrives to claim the harbour.");
  await page.getByLabel("Disaster 3").fill("The harbour burns and the townsfolk scatter.");
  await page.getByLabel("Ending").fill("The harbour is rebuilt from the ruins of the fleet.");
  await completeStepAndWait(page, "2 of 9 steps complete");
  console.log("PASS  step 2 completed");

  // 2c. Step 3: a character card is created and flagged major on-device.
  await page.locator(".sl-step-row").filter({ hasText: "Character summaries" }).click();
  await page.getByPlaceholder("Character name").fill("Emu Character");
  await page.getByRole("button", { name: "Add character" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).waitFor({ timeout: 15000 });
  await page.getByLabel("Major character").check();
  await completeStepAndWait(page, "3 of 9 steps complete");
  console.log("PASS  step 3 completed with a character card");

  // 2d. Step 4: the seed trigger + the rich-text editor render and complete on-device.
  await page.locator(".sl-step-row").filter({ hasText: "One-page synopsis" }).click();
  await page.getByRole("button", { name: /Break step 2 into step 4/ }).click();
  await page.locator(".ProseMirror").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800); // let the seeded content flush before completing
  await completeStepAndWait(page, "4 of 9 steps complete");
  console.log("PASS  step 4 completed via the seed trigger");

  // 2e. Step 8 on-device: paste three scenes, create them, complete the step.
  await page.locator(".sl-step-row").filter({ hasText: "Scene list" }).click();
  await page.getByRole("button", { name: /Paste from clipboard/ }).click();
  await page
    .getByRole("textbox", { name: "Paste a scene list" })
    .fill(
      "Emu Character\tThe ferry crosses at dawn\t1200\tChapter 1\nEmu Character\tA knife in the dark\t900\tChapter 1\nEmu Character\tThe harbour burns\t1100",
    );
  await page.getByRole("button", { name: "Create scenes from list" }).click();
  await page.getByText(/3 created/).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.waitForTimeout(800);
  await completeStepAndWait(page, "5 of 9 steps complete");
  console.log("PASS  step 8 paste import completed on-device");

  // 2f. Scenes tab on-device: rows render; the sheet round-trips a field.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page
    .getByText(/3 scenes/)
    .first()
    .waitFor({ timeout: 15000 });
  await page.locator(".sl-scene-line-main").first().click();
  await page.getByLabel("Objective").fill("Reach the customs office");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.locator(".sl-scene-line-main").first().click();
  const objective = await page.getByLabel("Objective").inputValue();
  if (objective !== "Reach the customs office") {
    throw new Error("scene sheet did not round-trip on-device");
  }
  await page.getByRole("button", { name: "Close" }).last().click();
  console.log("PASS  Scenes tab + scene sheet round-trip on-device");

  // 2g. Slice 5 on-device — step 9: expand a scene, copy the step-8 line in, complete.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.locator(".sl-step-row").filter({ hasText: "Scene narratives" }).click();
  await page.getByText(/of 3 expanded/).waitFor({ timeout: 20000 });
  await page.locator(".sl-scene-line-main").first().click();
  await page.getByRole("button", { name: /Copy step-8 line/ }).click();
  await page
    .getByText(/Step-8 line copied in as the first paragraph|already opens this synopsis/)
    .waitFor({ timeout: 20000 });
  await completeStepAndWait(page, "6 of 9 steps complete");
  console.log("PASS  step 9 accordion + copy-to-synopsis on-device");

  // 2h. Dashboard cards on-device: counts, continue list, manual snapshot.
  await page
    .getByText(/3 scenes/)
    .first()
    .waitFor({ timeout: 20000 });
  await page.getByText("Continue where you left off").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Snapshot now" }).click();
  await page.getByText(/Last backup/).waitFor({ timeout: 60000 });
  console.log("PASS  dashboard cards + manual snapshot on-device");

  // 2i. Undo toast on-device: delete a scene, bring it back from the toast.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page.getByRole("button", { name: "⋯ The ferry crosses at dawn" }).click();
  await page.getByRole("button", { name: "✕ Delete", exact: true }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await page.getByText("Scene deleted").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await page
    .locator(".sl-scene-line-main")
    .filter({ hasText: "The ferry crosses" })
    .waitFor({ timeout: 20000 });
  console.log("PASS  undo toast restored the scene on-device");

  // 2j. Trash round-trip on-device: delete, restore from the Trash screen. The undo toast from
  // 2i sits over the bottom of the list for eight seconds and swallows a row-menu tap, so wait
  // for it to clear first (the same single-slot toast trap the web journey documents).
  await page
    .locator(".sl-undo-toast")
    .waitFor({ state: "detached", timeout: 15000 })
    .catch(() => undefined);
  await page.getByRole("button", { name: "⋯ A knife in the dark" }).click();
  await page.getByRole("button", { name: "✕ Delete", exact: true }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("button", { name: /^Trash/ }).click();
  await page.getByRole("heading", { name: "Trash" }).waitFor({ timeout: 20000 });
  await page.getByText("A knife in the dark").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByText("Nothing in the trash.").waitFor({ timeout: 20000 });
  console.log("PASS  trash round-trip on-device");

  // 2k. Long-press drag reorder on-device (CDP mouse; the sensor threshold is 6 px). The
  // software-rendered device can swallow the first attempt, so retry up to three times.
  await page.getByRole("link", { name: "Scenes" }).click();
  let dragged = false;
  for (let attempt = 0; attempt < 3 && !dragged; attempt++) {
    const rows = page.locator(".sl-scene-line-main");
    const before = await rows.nth(0).innerText();
    const first = await rows.nth(0).boundingBox();
    const second = await rows.nth(1).boundingBox();
    if (first === null || second === null) throw new Error("scene rows not measurable on-device");
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, second.y + second.height / 2, { steps: 12 });
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(1000);
    dragged = (await rows.nth(0).innerText()) !== before;
  }
  if (!dragged) throw new Error("long-press drag did not reorder on-device");
  console.log("PASS  long-press drag reorder on-device");

  // 2l. Slice 6 on-device — World tab: the seeded taxonomy, an entry with its kind template,
  // an @-mention inserted from the picker, then delete → undo from the toast.
  await page.getByRole("link", { name: "World" }).click();
  await page.getByRole("heading", { name: "World" }).waitFor({ timeout: 30000 });
  await page.locator(".sl-tree-row").filter({ hasText: "Geography" }).waitFor({ timeout: 30000 });
  await page.locator(".sl-tree-row").filter({ hasText: "Geography" }).click();
  await page.getByPlaceholder("Entry name").fill("Emberfall");
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  await page
    .locator(".sl-lore-card")
    .filter({ hasText: "Emberfall" })
    .first()
    .waitFor({ timeout: 30000 });
  await page.locator(".sl-lore-card").filter({ hasText: "Emberfall" }).first().click();
  const loreSheet = page.getByRole("dialog", { name: "Emberfall" });
  await loreSheet.waitFor({ timeout: 30000 });
  await loreSheet.getByLabel("Climate").waitFor({ timeout: 20000 });
  await loreSheet.getByLabel("Summary").fill("A harbour town on the glass sea");
  await loreSheet.locator(".sl-editor-body .ProseMirror").click();
  await page.keyboard.type("North of the ruins lies ");
  await page.keyboard.type("@Emb");
  await page
    .locator(".sl-mention-popup .sl-mention-row")
    .filter({ hasText: "Emberfall" })
    .waitFor({ timeout: 20000 });
  await page.locator(".sl-mention-popup .sl-mention-row").filter({ hasText: "Emberfall" }).click();
  await loreSheet
    .locator(".sl-mention-chip")
    .filter({ hasText: "Emberfall" })
    .waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shotDir, "emu-slice6-lore.png"), fullPage: true });
  console.log("PASS  world tab + kind template + @-mention on-device");

  // Delete the entry and bring it back from the toast (the second undo of the session — the
  // undo button used to stay disabled after the first one).
  await loreSheet.getByRole("button", { name: "Delete entry" }).click();
  await loreSheet.getByRole("button", { name: "Tap again to delete" }).click();
  await page.getByText("Entry deleted").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await page
    .locator(".sl-lore-card")
    .filter({ hasText: "Emberfall" })
    .first()
    .waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Undo" }).waitFor({ state: "hidden", timeout: 20000 });
  console.log("PASS  lore delete → undo on-device");

  // 2m. Slice 7 on-device — backlinks, one-tap Link for a possible mention, the global search
  // sheet, the checks screen, and the two spec §5.1 budgets measured on the wasm path.
  await page.locator(".sl-lore-card").filter({ hasText: "Emberfall" }).first().click();
  const ember = page.getByRole("dialog", { name: "Emberfall" });
  await ember.waitFor({ timeout: 30000 });
  // The @-mention typed above is a self-reference: the panel must show at least one place.
  await ember.locator('[data-testid="sl-backlinks"] .sl-backlink-row').first().waitFor({
    timeout: 30000,
  });
  console.log("PASS  backlinks panel on-device");
  await ember.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(800);

  // A plain-text mention in another entry becomes the "Possible mentions" row we can Link.
  await page.getByPlaceholder("Entry name").fill("The Sundered Coast");
  await page.getByRole("button", { name: "New entry", exact: true }).click();
  await page
    .locator(".sl-lore-card")
    .filter({ hasText: "The Sundered Coast" })
    .first()
    .waitFor({ timeout: 30000 });
  await page.locator(".sl-lore-card").filter({ hasText: "The Sundered Coast" }).first().click();
  const coast = page.getByRole("dialog", { name: "The Sundered Coast" });
  await coast.waitFor({ timeout: 30000 });
  await coast.locator(".sl-editor-body .ProseMirror").click();
  await page.keyboard.type("Emberfall is west of the strait.");
  await page.waitForTimeout(1500);
  await coast.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(800);

  await page.locator(".sl-lore-card").filter({ hasText: "Emberfall" }).first().click();
  const emberAgain = page.getByRole("dialog", { name: "Emberfall" });
  await emberAgain.waitFor({ timeout: 30000 });
  const possibleRow = emberAgain.locator('[data-testid="sl-possible-mentions"] .sl-possible-row');
  await possibleRow.first().waitFor({ timeout: 30000 });
  const linksBefore = await emberAgain
    .locator('[data-testid="sl-backlinks"] .sl-backlink-row')
    .count();
  await possibleRow.first().getByRole("button", { name: "Link" }).click();
  await page.getByText("Mention linked").waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
  const linksAfter = await emberAgain
    .locator('[data-testid="sl-backlinks"] .sl-backlink-row')
    .count();
  if (linksAfter <= linksBefore) throw new Error("on-device Link did not add a backlink");
  await page.screenshot({ path: join(shotDir, "emu-slice7-backlinks.png"), fullPage: true });
  console.log("PASS  possible mention → Link on-device");
  await emberAgain.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(600);

  // Global search sheet from the app bar.
  await page.getByTestId("sl-search-open").click();
  const searchInput = page.locator("#sl-search-input");
  await searchInput.waitFor({ timeout: 20000 });
  await searchInput.fill("Ember");
  await page
    .locator('.sl-search-hit[data-entity-type="lore"]')
    .filter({ hasText: "Emberfall" })
    .first()
    .waitFor({ timeout: 20000 });
  await page.screenshot({ path: join(shotDir, "emu-slice7-search.png"), fullPage: true });
  console.log("PASS  global search sheet on-device");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(500);

  // Checks screen from the plan dashboard.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-checks-open").click();
  await page.getByRole("heading", { name: "Consistency checks" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(shotDir, "emu-slice7-checks.png"), fullPage: true });
  console.log("PASS  checks screen on-device");

  // Phone-path budgets through the wasm driver on this emulator (spec §5.1).
  const emuPerf = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const entries = await session.driver.query(
      "SELECT id FROM lore_entry WHERE name = 'Emberfall'",
    );
    return window.__starlineDev.perf(projects[0].id, "lore", entries[0].id, [
      "ember",
      "harbour",
      "coast",
      "scene",
      "character",
    ]);
  });
  // Phone-path numbers through the wasm driver on this emulator. The spec §5.1 budgets (10/30 ms)
  // are asserted where the reference machine lives — the native perf suite (in-process SQL) and
  // verify-web (Chromium with the same wasm driver); this emulator is a software-rendered VM
  // whose single-threaded wasm runs several times slower, so it guards against pathological
  // regressions (a 10× smoke ceiling) instead of pretending to be the reference machine.
  console.log(
    `PERF  emulator wasm: search p50 ${emuPerf.searchP50} ms / p95 ${emuPerf.searchP95} ms · backlinks p50 ${emuPerf.backlinkP50} ms / p95 ${emuPerf.backlinkP95} ms (smoke ceilings 120/60 ms)`,
  );
  if (emuPerf.searchP95 > 120)
    throw new Error(`emulator search smoke ceiling missed: ${emuPerf.searchP95} ms`);
  if (emuPerf.backlinkP95 > 60)
    throw new Error(`emulator backlink smoke ceiling missed: ${emuPerf.backlinkP95} ms`);

  // 2n. Slice 8 on-device — the relationship matrix (the slice's "smooth on the emulator" exit
  // criterion), creating an edge from a cell, and the web with a pinned node.
  await page.getByRole("link", { name: "People" }).click();
  // The matrix and the web need a pair; the on-device journey only creates one character.
  const emuCharacters = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT COUNT(*) AS total FROM character WHERE deleted_at IS NULL",
    );
    return Number(rows[0]?.total ?? 0);
  });
  if (emuCharacters < 2) {
    await page.getByPlaceholder("Quick add — name").fill("Tor Halden");
    await page.getByRole("button", { name: "Add character" }).click();
    await page.waitForTimeout(1200);
  }
  const matrixStart = Date.now();
  await page.getByTestId("sl-mode-matrix").click();
  await page.getByTestId("sl-matrix").waitFor({ timeout: 60000 });
  await page.locator(".sl-matrix-cell").first().waitFor({ timeout: 60000 });
  const matrixMs = Date.now() - matrixStart;
  const matrixCells = await page.locator(".sl-matrix-cell").count();
  console.log(`PERF  matrix ready in ${matrixMs} ms (${matrixCells} cells)`);
  if (matrixMs > 8000) throw new Error(`matrix took ${matrixMs} ms to appear on the emulator`);
  await page.screenshot({ path: join(shotDir, "emu-slice8-matrix.png"), fullPage: true });

  // Create an edge by tapping an empty cell; the sheet opens prefilled with the pair.
  const emptyCell = page.locator('.sl-matrix-cell[data-filled="false"]').first();
  if ((await emptyCell.count()) > 0) {
    await emptyCell.click();
    const emuSheet = page.getByTestId("sl-edge-sheet");
    await emuSheet.waitFor({ timeout: 30000 });
    await emuSheet.getByLabel("Kind", { exact: true }).selectOption("friend");
    await emuSheet.getByTestId("sl-edge-sentiment").fill("2");
    await page.screenshot({ path: join(shotDir, "emu-slice8-edge-sheet.png"), fullPage: true });
    await emuSheet.getByTestId("sl-edge-save").click();
    await emuSheet.waitFor({ state: "detached", timeout: 30000 });
    const stored = await page.evaluate(async () => {
      const session = window.__starlineDev.session();
      const rows = await session.driver.query(
        "SELECT kind, sentiment FROM character_relationship WHERE deleted_at IS NULL",
      );
      return rows;
    });
    const friend = stored.find((row) => row.kind === "friend");
    if (!friend || Number(friend.sentiment) !== 2) {
      throw new Error(`edge not stored on-device: ${JSON.stringify(stored)}`);
    }
    console.log(`PASS  edge created from a matrix cell on-device (${stored.length} edges)`);
  }

  // The web: nodes render, a drag pins one, and the list twin is there for screen readers.
  const graphStart = Date.now();
  await page.getByTestId("sl-mode-graph").click();
  await page.locator(".sl-graph-node").first().waitFor({ timeout: 60000 });
  const graphMs = Date.now() - graphStart;
  const graphNodes = await page.locator(".sl-graph-node").count();
  console.log(`PERF  web ready in ${graphMs} ms (${graphNodes} nodes)`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shotDir, "emu-slice8-graph.png"), fullPage: true });

  const wrapper = page.locator(".react-flow__node").first();
  const nodeBox = await wrapper.boundingBox();
  if (nodeBox) {
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 40, nodeBox.y + nodeBox.height / 2 + 30, {
      steps: 10,
    });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const pins = await page.evaluate(async () => {
      const session = window.__starlineDev.session();
      const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
      return window.__starlineDev.graphPositions(projects[0].id);
    });
    if (Object.keys(pins).length === 0) throw new Error("node drag did not pin on-device");
    console.log(`PASS  web node pinned on-device (${Object.keys(pins).length} pin)`);
  }

  await page.getByTestId("sl-graph-list-toggle").click();
  await page.locator('[data-testid="sl-rel-list"] tbody tr').first().waitFor({ timeout: 30000 });
  console.log("PASS  relationship list twin on-device");
  await page.getByTestId("sl-graph-list-toggle").click();
  await page.waitForTimeout(500);
  await page.getByRole("link", { name: "Plan" }).click();

  // 3. Hardware back: from a step screen back to the plan.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.locator(".sl-step-row").filter({ hasText: "Character descriptions" }).click();
  await page.getByText("Step 5 of 9").waitFor({ timeout: 15000 });
  adb(["shell", "input", "keyevent", "4"]);
  await page.getByText("6 of 9 steps complete").waitFor({ timeout: 15000 });
  console.log("PASS  hardware back returns to the plan");

  // 4. Hardware back walks out of history, then minimises the app at the root. The cap is
  // generous: every step/route visit pushes a history entry (this journey leaves ~15+).
  let minimised = false;
  for (let press = 0; press < 40 && !minimised; press++) {
    adb(["shell", "input", "keyevent", "4"]);
    await sleep(1200);
    const focus = adb(["shell", "dumpsys", "window"]).match(/mCurrentFocus=[^\n]*/)?.[0] ?? "";
    if (!focus.includes(PACKAGE)) {
      minimised = true;
      console.log(`PASS  back at root minimises after ${press + 1} press(es)`);
    }
  }
  if (!minimised) throw new Error("back presses never left the app");

  // 5. Cold relaunch: the library is listed and the plan survived (6 of 9).
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb(["shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`]);
  await browser.close().catch(() => undefined);
  ({ browser, page } = await connect());
  await page.getByText("Your libraries").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByText("6 of 9 steps complete").waitFor({ timeout: 90000 });
  console.log("PASS  cold relaunch → library listed → plan intact (6 of 9)");

  // The lore entry written before the relaunch survived too (wasm OPFS persistence on-device).
  await page.getByRole("link", { name: "World" }).click();
  await page
    .locator(".sl-lore-card")
    .filter({ hasText: "Emberfall" })
    .first()
    .waitFor({ timeout: 60000 });
  console.log("PASS  cold relaunch → lore entry intact");

  console.log("EMULATOR-QA OK");
} finally {
  await browser.close().catch(() => undefined);
}
