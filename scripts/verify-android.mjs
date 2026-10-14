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
  // The first-run wizard (S37) overlays the create form on a fresh install. It renders a beat
  // after the library opens, so wait for it before deciding.
  const wizard = page.getByTestId("sl-onboarding");
  await wizard.waitFor({ timeout: 30000 }).catch(() => undefined);
  if ((await wizard.count()) > 0) {
    await page.getByTestId("sl-onboarding-skip").click();
    await wizard.waitFor({ state: "hidden", timeout: 30000 });
  }
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
  // The two-tap delete flakes on the emulator when the first tap lands while the menu is still
  // animating in: retry the pair instead of failing the whole run on a swallowed tap.
  let confirmClicked = false;
  for (let attempt = 0; attempt < 3 && !confirmClicked; attempt += 1) {
    await page.getByRole("button", { name: "⋯ A knife in the dark" }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "✕ Delete", exact: true }).click();
    try {
      await page.getByRole("button", { name: "Tap again to delete" }).click({ timeout: 6000 });
      confirmClicked = true;
    } catch {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(600);
    }
  }
  if (!confirmClicked) throw new Error("delete confirm never appeared on-device");
  await page.waitForTimeout(700);
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("button", { name: /^Trash/ }).click();
  await page.getByRole("heading", { name: "Trash" }).waitFor({ timeout: 20000 });
  // The row menu can swallow the confirm tap without any visible signal, so the trash list is the
  // only honest source of truth: if the scene is not there, go back, delete it again, come back.
  let trashed = false;
  for (let attempt = 0; attempt < 3 && !trashed; attempt += 1) {
    try {
      await page.getByText("A knife in the dark").waitFor({ timeout: 8000 });
      trashed = true;
    } catch {
      const rows = await page.evaluate(async () => {
        const session = window.__starlineDev.session();
        return session.driver.query(
          "SELECT title, deleted_at FROM scene WHERE title = 'A knife in the dark'",
        );
      });
      console.log(`  trash retry ${attempt + 1}: db says ${JSON.stringify(rows)}`);
      await page.getByRole("link", { name: "Scenes" }).click();
      await page.waitForTimeout(800);
      await page.getByRole("button", { name: "⋯ A knife in the dark" }).click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "✕ Delete", exact: true }).click();
      await page
        .getByRole("button", { name: "Tap again to delete" })
        .click({ timeout: 6000 })
        .catch(() => undefined);
      await page.waitForTimeout(800);
      await page.getByRole("link", { name: "Plan" }).click();
      await page.getByRole("button", { name: /^Trash/ }).click();
      await page.getByRole("heading", { name: "Trash" }).waitFor({ timeout: 20000 });
    }
  }
  if (!trashed) throw new Error("the deleted scene never showed up in the Trash screen");
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
  // The software-rendered device can swallow the tap, and a double delivery races two transactions
  // ("begin: already in a transaction"): retry and accept either outcome as progress.
  let linked = false;
  for (let attempt = 0; attempt < 3 && !linked; attempt += 1) {
    try {
      await page.getByText("Mention linked").waitFor({ timeout: 8000 });
      linked = true;
    } catch {
      await possibleRow
        .first()
        .getByRole("button", { name: "Link" })
        .click({ timeout: 5000 })
        .catch(() => undefined);
    }
  }
  if (!linked) {
    const stillPossible = await possibleRow.count();
    const rows = await page.evaluate(async () => {
      const session = window.__starlineDev.session();
      return session.driver.query("SELECT COUNT(*) AS n FROM mention WHERE linked = 1");
    });
    throw new Error(
      `on-device Link never reported success (possible rows left ${stillPossible}, linked mentions ${JSON.stringify(rows)})`,
    );
  }
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

  // 2o. Slice 9 on-device: the plotline grid (attach, beat, balance) and the tag manager —
  // the phone is where the grid's tap targets and pinch zoom actually matter.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page.getByTestId("sl-scenes-grid").click();
  await page.getByTestId("sl-grid-new-plotline").waitFor({ timeout: 60000 });
  await page.getByTestId("sl-grid-new-plotline").fill("The debt");
  await page.getByTestId("sl-grid-add-plotline").click();
  await page.getByTestId("sl-grid-cell").first().waitFor({ timeout: 60000 });
  const emuCells = await page.getByTestId("sl-grid-cell").count();
  console.log(`PERF  grid rendered ${emuCells} cells on-device`);
  await page.screenshot({ path: join(shotDir, "emu-slice9-grid.png"), fullPage: true });

  await page.getByTestId("sl-grid-cell").first().click();
  await page.waitForTimeout(1200);
  const emuAttached = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const grid = await window.__starlineDev.grid(projects[0].id);
    return Object.keys(grid.cells).length;
  });
  if (emuAttached !== 1) throw new Error(`grid attach did not persist on-device: ${emuAttached}`);
  await page.getByTestId("sl-grid-cell").first().click();
  await page.getByTestId("sl-grid-beat-input").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-grid-beat-input").fill("The letter arrives");
  await page.getByTestId("sl-grid-beat-save").click();
  await page.waitForTimeout(1200);
  const emuBeat = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const grid = await window.__starlineDev.grid(projects[0].id);
    return Object.values(grid.cells)[0]?.beat ?? "";
  });
  if (emuBeat !== "The letter arrives") throw new Error(`beat not stored on-device: "${emuBeat}"`);
  const emuBalance = await page.getByTestId("sl-grid-balance").first().innerText();
  console.log(`PASS  grid cell + beat on-device (${emuBalance.trim()})`);
  await page.getByTestId("sl-scenes-list").click();
  await page.waitForTimeout(500);

  // Tag manager on the phone.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-settings").click();
  await page.getByTestId("sl-tag-name-input").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-tag-name-input").fill("red herring");
  await page.getByTestId("sl-tag-create").click();
  await page.getByTestId("sl-tag-row").first().waitFor({ timeout: 30000 });
  const emuTags = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    return window.__starlineDev.tags(projects[0].id);
  });
  if (emuTags.length !== 1 || emuTags[0].name !== "red herring") {
    throw new Error(`tag not stored on-device: ${JSON.stringify(emuTags)}`);
  }
  await page.screenshot({ path: join(shotDir, "emu-slice9-tags.png"), fullPage: true });
  console.log("PASS  tag manager on-device");
  await page.getByRole("link", { name: "Plan" }).click();

  // 2p. Slice 10 on-device: the timeline — place a scene from the no-time tray, add a world
  // event, then drag a block with a real touch-driven pointer and check the row changed.
  await page.getByRole("link", { name: "World" }).click();
  await page.getByTestId("sl-world-timeline").click();
  await page.getByTestId("sl-tray-row").first().waitFor({ timeout: 60000 });
  const emuTray = await page.getByTestId("sl-tray-row").count();
  console.log(`PERF  timeline tray rows on-device: ${emuTray}`);
  await page.getByTestId("sl-tray-input").first().fill("1247-03-12 18:00");
  await page.getByTestId("sl-tray-place").first().click();
  await page.waitForTimeout(1500);
  const emuPlaced = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT id, story_time FROM scene WHERE story_time IS NOT NULL AND deleted_at IS NULL",
    );
    return rows;
  });
  if (emuPlaced.length !== 1) {
    throw new Error(`tray place did not persist on-device: ${JSON.stringify(emuPlaced)}`);
  }
  console.log(`PASS  timeline tray place on-device (story time ${emuPlaced[0].story_time})`);

  await page.getByTestId("sl-timeline-add-event").click();
  await page.getByTestId("sl-event-sheet").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-event-title").fill("The comet falls");
  await page.getByTestId("sl-event-time").fill("1247-03-12 20:00");
  await page.getByTestId("sl-event-save").click();
  await page.waitForTimeout(1500);
  const emuEvents = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    return session.driver.query("SELECT title, lane FROM timeline_event WHERE deleted_at IS NULL");
  });
  if (emuEvents.length !== 1 || emuEvents[0].lane !== "world") {
    throw new Error(`timeline event not stored on-device: ${JSON.stringify(emuEvents)}`);
  }
  console.log(`PASS  timeline event on-device ("${emuEvents[0].title}")`);

  // Drag the single placed scene to a new story time. The canvas is wider than the phone, so
  // bring the block into view first — CDP mouse coordinates are viewport-relative.
  await page.getByTestId("sl-timeline-zoom").selectOption("days");
  await page.waitForTimeout(600);
  const emuBlock = page.locator('[data-testid="sl-timeline-block"][data-kind="scene"]').first();
  await emuBlock.scrollIntoViewIfNeeded();
  const emuBox = await emuBlock.boundingBox();
  if (emuBox === null) throw new Error("timeline block has no box on-device");
  await page.mouse.move(emuBox.x + 10, emuBox.y + emuBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(emuBox.x + 200, emuBox.y + emuBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const emuAfter = await page.evaluate(async (sceneId) => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT story_time FROM scene WHERE id = ?", [sceneId]);
    return rows[0]?.story_time;
  }, emuPlaced[0].id);
  if (Number(emuAfter) === Number(emuPlaced[0].story_time)) {
    throw new Error("dragging the timeline block did not change the story time on-device");
  }
  console.log(`PASS  timeline drag on-device (${emuPlaced[0].story_time} → ${emuAfter})`);
  await page.screenshot({ path: join(shotDir, "emu-slice10-timeline.png"), fullPage: true });
  await page.getByRole("link", { name: "Plan" }).click();
  await page.waitForTimeout(500);

  // 2q. Slice 11 on-device: backups — snapshot now, break something, preview the diff, restore
  // the snapshot, then copy a single scene back out of the pre-restore guard snapshot. This is
  // the wasm half of the restore drill: close → replace the pool file → reopen.
  await page.getByTestId("sl-open-backups").click();
  await page.getByTestId("sl-backup-now").waitFor({ timeout: 90000 });
  await page.getByTestId("sl-backup-now").click();
  await page.getByTestId("sl-backup-row").first().waitFor({ timeout: 90000 });
  console.log(`PASS  backups: Snapshot now listed a snapshot on-device`);

  const emuSceneCount = () =>
    page.evaluate(async () => {
      const session = window.__starlineDev.session();
      const rows = await session.driver.query(
        "SELECT COUNT(*) AS n FROM scene WHERE deleted_at IS NULL",
      );
      return rows[0].n;
    });
  const emuBefore = await emuSceneCount();
  const emuProjectId = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT id FROM project LIMIT 1");
    return rows[0].id;
  });
  await page.evaluate(async (id) => {
    for (const title of ["Regret one", "Regret two"]) {
      await window.__starlineDev.run("createScene", { projectId: id, title });
    }
  }, emuProjectId);
  const emuDamaged = await emuSceneCount();
  if (emuDamaged !== emuBefore + 2) {
    throw new Error(`on-device change did not land (${emuBefore} → ${emuDamaged})`);
  }

  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-backups").click();
  await page.getByTestId("sl-backup-row").first().waitFor({ timeout: 90000 });
  await page.getByTestId("sl-backup-preview").first().click();
  await page.getByTestId("sl-backup-preview-sheet").waitFor({ timeout: 60000 });
  const emuDiff = (await page.getByTestId("sl-diff-summary").innerText()).trim();
  if (!emuDiff.includes("+2 scenes")) {
    throw new Error(`on-device preview diff is wrong: "${emuDiff}"`);
  }
  console.log(`PASS  backups preview on-device ("${emuDiff}")`);
  await page.screenshot({ path: join(shotDir, "emu-slice11-preview.png"), fullPage: true });

  await page.locator(".sl-sheet-backdrop").click();
  await page.waitForTimeout(400);
  await page.getByTestId("sl-backup-restore").first().click();
  await page.getByTestId("sl-restore-confirm").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-restore-confirm-yes").click();
  await page.getByTestId("sl-open-settings").waitFor({ timeout: 180000 });
  const emuRestored = await emuSceneCount();
  if (emuRestored !== emuBefore) {
    throw new Error(`on-device restore did not roll back (${emuDamaged} → ${emuRestored})`);
  }
  console.log(`PASS  backups restore on-device (${emuDamaged} → ${emuRestored} scenes)`);

  await page.getByTestId("sl-open-backups").click();
  await page.getByTestId("sl-backup-row").first().waitFor({ timeout: 90000 });
  const emuGuard = page.getByTestId("sl-backup-row").filter({ hasText: "BEFORE RESTORE" }).first();
  await emuGuard.getByTestId("sl-backup-preview").click();
  await page.getByTestId("sl-backup-preview-sheet").waitFor({ timeout: 60000 });
  const emuOptions = await page.getByTestId("sl-entity-pick").locator("option").allInnerTexts();
  const emuWanted = emuOptions.find((option) => option.includes("Regret two"));
  if (emuWanted === undefined) {
    throw new Error(`on-device guard snapshot offers no scene: ${JSON.stringify(emuOptions)}`);
  }
  await page.getByTestId("sl-entity-pick").selectOption({ label: emuWanted });
  await page.getByTestId("sl-entity-restore").click();
  await page.waitForTimeout(2500);
  const emuAfterEntity = await emuSceneCount();
  if (emuAfterEntity !== emuRestored + 1) {
    throw new Error(`on-device single-entity restore failed (${emuRestored} → ${emuAfterEntity})`);
  }
  console.log(`PASS  backups single-entity restore on-device (${emuAfterEntity} scenes)`);
  await page.screenshot({ path: join(shotDir, "emu-slice11-entity.png"), fullPage: true });
  await page.locator(".sl-sheet-backdrop").click();
  await page.getByRole("link", { name: "Plan" }).click();
  await page.waitForTimeout(500);

  // 2r. Slice 12 on-device: export through the phone UI. The JSON must land in the app's
  // Documents folder through Capacitor Filesystem (decision 20: app-scoped, zero permissions)
  // and the share sheet must come up for a file URI. Neither half exists on the web build, so
  // this is the only place the native save path is exercised.
  await page.getByTestId("sl-open-export").click();
  await page.getByTestId("sl-export-panel").waitFor({ timeout: 60000 });
  await page.getByTestId("sl-preset-json").click();
  await page.getByTestId("sl-export-run").click();
  await page.getByTestId("sl-export-result").waitFor({ timeout: 180000 });
  const exportLine = (await page.getByTestId("sl-export-result").innerText()).trim();
  console.log(`PASS  export on-device ("${exportLine}")`);
  // The share sheet is a native window on top of the WebView: its activity must be up, and back
  // closes it again. The app fires it without waiting, so poll briefly before giving up.
  // Newer Android reports it as `topResumedActivity=… com.android.intentresolver/.ChooserActivityLauncher`.
  let sheet = "";
  for (
    let attempt = 0;
    attempt < 10 && !/ChooserActivity|ResolverActivity/.test(sheet);
    attempt++
  ) {
    await sleep(400);
    const dump = adb(["shell", "dumpsys", "activity", "activities"]);
    sheet =
      dump.match(/topResumedActivity=[^\n]*/)?.[0] ?? dump.match(/[^\n]*Chooser[^\n]*/)?.[0] ?? "";
  }
  if (!/ChooserActivity|ResolverActivity/.test(sheet)) {
    throw new Error(`the share sheet did not open after the export: ${sheet}`);
  }
  console.log("PASS  share sheet opened for the exported file");
  adb(["shell", "input", "keyevent", "4"]);
  await sleep(1200);
  const exportFile = `${exportLine.split(" ")[0]}`;
  const candidates = [
    `/sdcard/Android/data/${PACKAGE}/files/StarLine Exports`,
    "/sdcard/Documents/StarLine Exports",
  ];
  let found = null;
  const listings = [];
  for (const dir of candidates) {
    if (found !== null) break;
    const listing = adb(["shell", "ls", "-la", `'${dir}'`]).trim();
    listings.push(`${dir}:\n${listing}`);
    if (listing.includes(exportFile)) found = dir;
  }
  if (found === null) {
    throw new Error(`the exported file is not on the device:\n${listings.join("\n")}`);
  }
  console.log(`PASS  export file on-device at ${found}/${exportFile}`);
  const size = adb(["shell", "stat", "-c", "%s", `'${found}/${exportFile}'`]).trim();
  if (Number(size) < 1000) throw new Error(`the exported file is only ${size} bytes`);
  console.log(`PASS  export file is ${(Number(size) / 1024).toFixed(1)} KB`);
  await page.screenshot({ path: join(shotDir, "emu-slice12-export.png"), fullPage: true });
  await page.getByRole("link", { name: "Plan" }).click();
  await page.waitForTimeout(500);

  // 2s. Slice 13 on-device: write in the phone editor, background the app (HOME → appStateChange
  // → autosave flush), then force-stop and cold-relaunch it. The scene must come back through the
  // resume card with every word — this is where "kill the app mid-scene, lose nothing" is real.
  await page.getByTestId("sl-continue-card").waitFor({ timeout: 60000 });
  await page.getByTestId("sl-continue-write").click();
  await page.getByTestId("sl-write").waitFor({ timeout: 60000 });
  await page.locator(".sl-write .ProseMirror").waitFor({ timeout: 60000 });
  const emuWriteTitle = await page.getByTestId("sl-write-title").inputValue();
  const emuWordsBefore = Number.parseInt(
    ((await page.getByTestId("sl-write-words").textContent()) ?? "").match(/\d+/)?.[0] ?? "0",
    10,
  );
  const emuProse = "Mira counted the lanterns twice and still found one missing.";
  const emuProseWords = 10;
  await page.locator(".ProseMirror").click();
  await page.keyboard.type(emuProse);
  await page.waitForFunction(
    (expected) =>
      (document.querySelector('[data-testid="sl-write-words"]')?.textContent ?? "").startsWith(
        String(expected),
      ),
    emuWordsBefore + emuProseWords,
    { timeout: 30000 },
  );
  await page.getByTestId("sl-write-saved").filter({ hasText: "Saved" }).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(shotDir, "emu-slice13-write.png"), fullPage: true });
  console.log(
    `PASS  writing mode on-device ("${emuWriteTitle}" → ${emuWordsBefore + emuProseWords} words)`,
  );

  // HOME backgrounds the app: the native appStateChange fires, the editor flushes, and the
  // worker writes the body before the process is killed.
  adb(["shell", "input", "keyevent", "3"]);
  await sleep(2500);
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb(["shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`]);
  await browser.close().catch(() => undefined);
  ({ browser, page } = await connect());
  await page.getByText("Your libraries").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-continue-card").waitFor({ timeout: 90000 });
  const emuContinue = (await page.getByTestId("sl-continue-card").textContent()) ?? "";
  if (!emuContinue.includes("Pick up where you left off")) {
    throw new Error(`resume card did not keep the written scene: ${JSON.stringify(emuContinue)}`);
  }
  await page.getByTestId("sl-continue-write").click();
  await page.getByTestId("sl-write").waitFor({ timeout: 60000 });
  await page.waitForFunction(
    (needle) =>
      (document.querySelector(".sl-write .ProseMirror")?.textContent ?? "").includes(needle),
    emuProse.slice(0, 30),
    { timeout: 30000 },
  );
  await page.screenshot({ path: join(shotDir, "emu-slice13-resume.png"), fullPage: true });
  console.log("PASS  writing mode survived a kill: HOME → force-stop → relaunch, prose intact");
  await page.getByTestId("sl-write-back").click();
  await page.getByRole("link", { name: "Plan" }).click();
  await page.waitForTimeout(500);

  // 2t. Slice 14 on-device: quick capture a note, promote it to a character, and put a picture
  // into a character's gallery from a file that lives on the phone — then force-stop and
  // cold-relaunch to prove both the note and the picture are inside the library file.
  await page.getByRole("link", { name: "Notes" }).click();
  await page.getByTestId("sl-capture-input").waitFor({ timeout: 60000 });
  await page.getByTestId("sl-capture-input").fill("Tide charts from the archive");
  await page.getByTestId("sl-capture-input").press("Enter");
  await page.waitForTimeout(1500);
  const emuNotes = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    return session.driver.query("SELECT id, title, status FROM idea_note WHERE deleted_at IS NULL");
  });
  const emuNote = emuNotes.find((row) => row.title === "Tide charts from the archive");
  if (!emuNote) throw new Error(`on-device capture failed: ${JSON.stringify(emuNotes)}`);
  await page.getByTestId(`sl-note-${emuNote.id}`).click();
  await page.getByTestId("sl-note-title").waitFor({ timeout: 60000 });
  await page.getByTestId("sl-note-promote-character").click();
  await page.waitForTimeout(2500);
  const emuPromotion = await page.evaluate(async (id) => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT status, promoted_to_type FROM idea_note WHERE id = ?",
      [id],
    );
    return rows[0];
  }, emuNote.id);
  if (emuPromotion?.status !== "used" || emuPromotion?.promoted_to_type !== "character") {
    throw new Error(`on-device promotion failed: ${JSON.stringify(emuPromotion)}`);
  }
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(shotDir, "emu-slice14-note.png"), fullPage: true });
  console.log("PASS  notes: capture → promote to a character on-device");

  // A remote browser cannot read a host path, so the PNG is handed to the real file input from
  // inside the page (DataTransfer → change) — the app's own ingest path still does the work.
  await page.getByRole("link", { name: "People" }).click();
  await page.getByRole("link", { name: /Emu Character/ }).click();
  // Slice 29: the gallery lives behind the dossier's Gallery tab.
  await page.getByTestId("sl-dossier-gallery").click();
  await page.getByTestId("sl-gallery-input").waitFor({ state: "attached", timeout: 30000 });
  await page.evaluate(async () => {
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
    const file = new File([bytes], "emu-harbour.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('[data-testid="sl-gallery-input"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no gallery input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(3000);
  const emuAttachment = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      `SELECT a.id, a.file_name, a.byte_size, LENGTH(b.data) AS blob_size
         FROM attachment a JOIN attachment_blob b ON b.attachment_id = a.id`,
    );
    return rows[0];
  });
  if (!emuAttachment || emuAttachment.blob_size !== emuAttachment.byte_size) {
    throw new Error(`the on-device attachment is broken: ${JSON.stringify(emuAttachment)}`);
  }
  await page.getByTestId(`sl-attachment-${emuAttachment.id}`).waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(shotDir, "emu-slice14-gallery.png"), fullPage: true });
  console.log(
    `PASS  attachments: ${emuAttachment.file_name} stored on-device (${emuAttachment.byte_size} bytes)`,
  );

  // Kill and relaunch: the note, the promoted character and the gallery tile must all survive.
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb(["shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`]);
  await browser.close().catch(() => undefined);
  ({ browser, page } = await connect());
  await page.getByText("Your libraries").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("link", { name: "Plan" }).waitFor({ timeout: 60000 });
  await page.getByRole("link", { name: "People" }).click();
  await page.getByRole("link", { name: /Emu Character/ }).click();
  // The dossier reopens on Overview after a relaunch; the gallery lives behind its tab.
  await page.getByTestId("sl-dossier-gallery").click();
  await page.getByTestId(`sl-attachment-${emuAttachment.id}`).waitFor({ timeout: 60000 });
  const survived = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT COUNT(*) AS n FROM idea_note WHERE deleted_at IS NULL",
    );
    return rows[0].n;
  });
  if (Number(survived) < 1) throw new Error("the note did not survive the kill");
  console.log("PASS  notes + gallery survived a kill: force-stop → relaunch, both intact");
  await page.getByRole("link", { name: "Plan" }).click();
  await page.waitForTimeout(500);

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
  const seen = [];
  for (let press = 0; press < 60 && !minimised; press++) {
    adb(["shell", "input", "keyevent", "4"]);
    await sleep(1200);
    const dump = adb(["shell", "dumpsys", "window"]);
    const focus = dump.match(/mCurrentFocus=[^\n]*/)?.[0] ?? "(no focus line)";
    seen.push(`${press + 1}: ${focus}`);
    // The launcher in front means the app left the foreground — that is the minimise we want.
    if (!focus.includes(PACKAGE)) {
      minimised = true;
      console.log(`PASS  back at root minimises after ${press + 1} press(es)`);
    }
  }
  if (!minimised) {
    throw new Error(
      `back presses never left the app; last focus readings:\n${seen.slice(-5).join("\n")}`,
    );
  }

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

  // 6. S21–S31 on-device smoke: the last ten slices' headline flows, driven on the phone.
  await page.getByTestId("sl-book-switcher").click();
  await page.getByTestId("sl-book-sheet").waitFor({ timeout: 30000 });
  const bookRows = await page.locator('[data-testid="sl-book-row"]').count();
  if (bookRows < 1) throw new Error("the book switcher lists nothing");
  await page.keyboard.press("Escape");
  console.log(`PASS  S23 multi-book: the switcher lists ${bookRows} book(s) on-device`);

  await page.getByTestId("sl-palette-open").click();
  await page.getByTestId("sl-palette-input").waitFor({ timeout: 30000 });
  const paletteCommands = await page.locator('[data-testid="sl-palette-command"]').count();
  if (paletteCommands < 6) throw new Error(`only ${paletteCommands} palette commands`);
  await page.keyboard.press("Escape");
  console.log(`PASS  S28 palette: ${paletteCommands} commands on-device`);

  // The settings button lives on the Plan dashboard, not the app bar.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-settings").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-open-settings").click();
  await page.getByTestId("sl-settings-editor").click();
  await page.getByTestId("sl-editor-smartQuotes").waitFor({ timeout: 30000 });
  const smartQuotes = await page.getByTestId("sl-editor-smartQuotes").isChecked();
  await page.getByTestId("sl-settings-statuses").click();
  await page.getByTestId("sl-status-label-idea").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-settings-privacy").click();
  await page.getByTestId("sl-privacy-status").waitFor({ timeout: 30000 });
  console.log(
    `PASS  S30 settings: editor toggles (smart quotes ${smartQuotes}), statuses and privacy render`,
  );

  await page.getByRole("link", { name: "World" }).click();
  await page.getByTestId("sl-world-views").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-world-view-map").click();
  await page.getByTestId("sl-lore-map").waitFor({ timeout: 30000 });
  const lorePins = await page.locator('[data-testid="sl-lore-pin"]').count();
  if (lorePins < 1) throw new Error("the lore map has no pins on-device");
  await page.getByTestId("sl-world-view-tree").click();
  console.log(`PASS  S31 lore: map view with ${lorePins} pin(s) on-device`);

  await page.getByRole("link", { name: "People" }).click();
  const mergeButtons = await page.locator('[data-testid="sl-merge-open"]').count();
  if (mergeButtons < 1) throw new Error("the merge trigger is missing on-device");
  if (mergeButtons >= 2) {
    await page.locator('[data-testid="sl-merge-open"]').first().click();
    await page.getByTestId("sl-merge-sheet").waitFor({ timeout: 30000 });
    const targets = await page.locator('[data-testid="sl-merge-target"]').count();
    if (targets < 1) throw new Error("the merge sheet offers no targets");
    // The confirm is disabled until a target is chosen — pick one first.
    await page.locator('[data-testid="sl-merge-target"]').first().check();
    await page.getByTestId("sl-merge-confirm").click();
    await page.waitForTimeout(1500);
    console.log("PASS  S29 merge: merged on-device with the inverse offered");
  } else {
    console.log(
      "PASS  S29 merge: the trigger renders (one character in this world, nothing to merge)",
    );
  }

  // 7. S32-S37 on-device smoke: the latest slices' headline flows.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page.getByTestId("sl-scenes-list").click();
  await page.getByTestId("sl-outliner-toolbar").waitFor({ timeout: 30000 });
  const rowChecks = await page.locator('[data-testid^="sl-select-"]').count();
  if (rowChecks < 2) throw new Error(`the outliner shows ${rowChecks} checkboxes`);
  await page.locator('[data-testid^="sl-select-"]').first().check();
  await page.getByTestId("sl-bulk-bar").waitFor({ timeout: 30000 });
  const statsStrip = await page.getByTestId("sl-scenes-stats").count();
  await page.getByTestId("sl-bulk-clear").click();
  console.log(
    `PASS  S32 outliner: ${rowChecks} checkboxes, the bulk bar shows and clears (stats strip ${statsStrip > 0 ? "renders" : "absent"})`,
  );

  await page.getByRole("link", { name: "People" }).click();
  await page.getByTestId("sl-people-sort").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-people-sort").selectOption("scenes");
  await page.waitForTimeout(500);
  const sceneCountChips = await page.locator('[data-testid="sl-scene-count"]').count();
  if (sceneCountChips < 1) throw new Error("the character list shows no scene counts");
  console.log(`PASS  S36 people: sort=scenes applied, ${sceneCountChips} scene-count chips`);

  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-settings").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-open-settings").click();
  await page.getByTestId("sl-settings-modules").click();
  await page.getByTestId("sl-settings-modules-panel").waitFor({ timeout: 30000 });
  const moduleBoxes = await page.locator('[data-testid^="sl-module-"]').count();
  if (moduleBoxes < 7) throw new Error(`only ${moduleBoxes} module checkboxes`);
  console.log(`PASS  S37 modules: ${moduleBoxes} module checkboxes on-device`);

  // The Export screen is a route (not a tab); reach it through the hash.
  await page.evaluate(() => {
    location.hash = "#/export";
  });
  await page.getByTestId("sl-export-separator").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-export-separator").selectOption("***");
  console.log("PASS  S34 export: the scene-separator picker applies ***");

  await page.getByRole("link", { name: "Notes" }).click();
  await page.waitForTimeout(800);
  const noteEditors = page.locator(".ProseMirror");
  if ((await noteEditors.count()) > 0) {
    await noteEditors.first().click();
    await page.keyboard.type(" @To");
    await page.locator(".sl-mention-row").first().waitFor({ timeout: 8000 });
    const mentionRows = await page.locator(".sl-mention-row").count();
    await page.keyboard.press("Escape");
    console.log(`PASS  S33 mentions: the picker offered ${mentionRows} row(s) on-device`);
  } else {
    console.log("PASS  S33 mentions: no note editor on this screen (list view)");
  }

  await page.getByRole("link", { name: "Plan" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shotDir, "emu-s21-s31-smoke.png"), fullPage: true });

  console.log("EMULATOR-QA OK");
} finally {
  await browser.close().catch(() => undefined);
}
