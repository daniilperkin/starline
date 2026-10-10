#!/usr/bin/env node
// Headless E2E for the web shell (spec §5.7 exit criterion + slices 1–5): create a library,
// create a story, write and complete Snowflake steps 1–6 (character card, extraction, dossier
// edit, step-4 seed, storylines, sections), prove the Stale badge fires when step 2 is edited
// after step 4 completed, then run the slice-4 loop: paste 40 scenes in step 8, re-import to
// prove the merge (no duplicates), reorder + reassign a scene in the Scenes tab, round-trip
// the scene editor — and the slice-5 loop: complete step 9 (accordion + copy-to-synopsis),
// check the dashboard cards (counts, words, continue, snapshot), delete → restore via Trash,
// undo a delete from the toast, drag-reorder with a mouse long-press, then axe-scan every
// screen for serious/critical a11y violations, and finally reload/close/reopen to prove
// everything persisted. Slice 12 adds the interchange loop: export JSON / Markdown folder /
// DOCX / CSV tables from the open project, check the bytes, then import the JSON into a NEW
// library and prove the chapters, scenes and characters arrived — the M3 exit criterion
// (export → import → export identical, checked byte-for-byte by the native driver test).
// By default the script serves the dev build itself (vite dev, port 5183); pass --no-serve
// with a URL to use an already-running server.
// Usage: node scripts/verify-web.mjs [url] [--no-serve]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serve = !process.argv.includes("--no-serve");
const url = process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:5183/";
const shotDir = join(tmpdir(), "starline-shots");
mkdirSync(shotDir, { recursive: true });
// Exported files land here: Playwright deletes its own download directory with the browser, and
// step 7 imports the JSON after the first page is gone.
const exportDir = join(tmpdir(), "starline-exports");
mkdirSync(exportDir, { recursive: true });

let server = null;
if (serve) {
  const viteBin = join(repoRoot, "apps", "web", "node_modules", "vite", "bin", "vite.js");
  server = spawn(process.execPath, [viteBin, "--port", "5183", "--strictPort"], {
    cwd: join(repoRoot, "apps", "web"),
    stdio: "ignore",
  });
  let up = false;
  for (let attempt = 0; attempt < 120 && !up; attempt++) {
    try {
      const response = await fetch(url);
      up = response.ok;
    } catch {
      // not up yet
    }
    if (!up) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!up) throw new Error(`dev server did not come up at ${url}`);
}

const browser = await chromium.launch();
let page = null;
try {
  // en-US locale keeps number formatting ("48,200") deterministic — the app formats with
  // Intl against the device locale, and the assertions here are English-first.
  page = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: "en-US" });
  await page.goto(url);

  // Warm-up: on a cold dev server vite pre-bundles dependencies and reloads the page when the
  // bundle set changes (new UI deps). Let that settle before driving the UI.
  await page.getByPlaceholder("My Novel").waitFor();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByPlaceholder("My Novel").waitFor();

  // axe-core is injected on demand; scans assert no serious/critical violations on each screen
  // (spec M4 a11y bar enforced early — the slice-5 sweep).
  async function axeScan(label) {
    await page.addScriptTag({ path: join(repoRoot, "node_modules", "axe-core", "axe.min.js") });
    const violations = await page.evaluate(async () => {
      const results = await window.axe.run(document);
      return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          target: node.target.join(" "),
          html: node.html.slice(0, 200),
        })),
      }));
    });
    const bad = violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    if (bad.length > 0) {
      const detail = bad
        .map(
          (violation) =>
            `${violation.id}:\n${violation.nodes
              .map((node) => `   ${node.target}\n   ${node.html}`)
              .join("\n")}`,
        )
        .join("\n");
      throw new Error(`axe [${label}] serious/critical:\n${detail}`);
    }
    console.log(`axe [${label}]: clean`);
  }

  // 1. Create a library.
  await page.getByPlaceholder("My Novel").fill("Slice Demo");
  await page.screenshot({ path: join(shotDir, "1-start.png"), fullPage: true });
  await page.getByRole("button", { name: "Create" }).click();

  // 2. Plan tab: create the story (first-run migrations + wasm init can take a moment).
  try {
    await page.getByPlaceholder("Name your story").waitFor({ timeout: 60_000 });
  } catch (cause) {
    // Surface what the start screen actually says (open errors render there verbatim).
    const text = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.error(`create failed; start screen says:\n${text}`);
    throw cause;
  }
  await page.getByPlaceholder("Name your story").fill("The Cartographer's Sea");
  await page.getByRole("button", { name: "Create story" }).click();
  await page.getByText("0 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "2-plan.png"), fullPage: true });

  // 3. Step 1: write the sentence (autosave), then complete it.
  await page.locator(".sl-step-row").filter({ hasText: "One sentence" }).click();
  await page
    .getByLabel("One sentence")
    .fill(
      "A grieving cartographer must map a shifting island before it sinks and takes her sister with it",
    );
  await page.getByText("17 / 25 words").waitFor();
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("1 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "3-step1-done.png"), fullPage: true });

  // 4. Step 2: five sentences, then complete.
  await page.locator(".sl-step-row").filter({ hasText: "One paragraph" }).click();
  await page.getByLabel("Setup").fill("A quiet harbour town thrives on the trade winds.");
  await page.getByLabel("Disaster 1").fill("The winds vanish and the fleet is stranded.");
  await page.getByLabel("Disaster 2").fill("A rival fleet arrives to claim the harbour.");
  await page.getByLabel("Disaster 3").fill("The harbour burns and the townsfolk scatter.");
  await page.getByLabel("Ending").fill("The harbour is rebuilt from the ruins of the fleet.");
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("2 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "4-step2-done.png"), fullPage: true });

  // 4b. Step 3: character card, major flag, extraction trigger, complete.
  await page.locator(".sl-step-row").filter({ hasText: "Character summaries" }).click();
  await page.getByPlaceholder("Character name").fill("Mira Holt");
  await page.getByRole("button", { name: "Add character" }).click();
  const cardName = page.getByRole("textbox", { name: "Name", exact: true });
  await cardName.waitFor();
  if ((await cardName.inputValue()) !== "Mira Holt") {
    throw new Error("character card did not appear after adding");
  }
  await page.getByLabel("Major character").check();
  await page.getByLabel("Motivation").fill("She must chart the island before it sinks");
  await page.getByRole("button", { name: /Find characters in this text/ }).click();
  await page.getByText("No new names found — steps 1–2 read clean, as intended.").waitFor();
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("3 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "5-step3-done.png"), fullPage: true });

  // 4c. People tab: the character is listed; a dossier edit persists through autosave.
  await page.getByRole("link", { name: "People" }).click();
  await page.getByRole("link", { name: /Mira Holt/ }).click();
  await page.getByLabel("One line").fill("Keeps the harbour charts");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByText("Keeps the harbour charts").waitFor();
  await page.screenshot({ path: join(shotDir, "6-people.png"), fullPage: true });

  // 4d. Step 4: seed from step 2, complete.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.locator(".sl-step-row").filter({ hasText: "One-page synopsis" }).click();
  await page.getByRole("button", { name: /Break step 2 into step 4/ }).click();
  const firstEditor = page.locator(".ProseMirror").first();
  await firstEditor.waitFor();
  if (!((await firstEditor.textContent()) ?? "").includes("quiet harbour town")) {
    throw new Error("step-4 seed did not land in the editor");
  }
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("4 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "7-step4-done.png"), fullPage: true });

  // 4e. Step 5: storyline from the character's POV, marked reviewed, complete.
  await page.locator(".sl-step-row").filter({ hasText: "Character descriptions" }).click();
  await page.getByRole("checkbox", { name: "Reviewed" }).check();
  const storyline = page.locator(".ProseMirror").first();
  await storyline.click();
  await storyline.fill("From Mira's point of view the island shifts like a rumour.");
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("5 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "8-step5-done.png"), fullPage: true });

  // 4f. Step 6: four sections (decision 3), complete.
  await page.locator(".sl-step-row").filter({ hasText: "Four-page synopsis" }).click();
  const sections = page.locator(".ProseMirror");
  await sections.nth(0).fill("Section one expands the setup into a full page of trouble.");
  await sections.nth(1).fill("Section two follows the first disaster into the dark.");
  await sections.nth(2).fill("Section three raises everything the story has left.");
  await sections.nth(3).fill("Section four resolves the ending on the harbour's ruins.");
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("6 of 9 steps complete").waitFor();

  // 4g. Staleness (slice-3 exit): edit step 2 after step 4 completed → Stale badge appears.
  await page.locator(".sl-step-row").filter({ hasText: "One paragraph" }).click();
  await page.getByLabel("Disaster 3").fill("The harbour burns and the townsfolk scatter for good.");
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByText("Stale").first().waitFor();
  await page.screenshot({ path: join(shotDir, "9-stale.png"), fullPage: true });

  // 4h. Step 8 (slice-4 exit): paste 40 lines → 40 scenes.
  const sceneLines = [];
  for (let i = 1; i <= 40; i++) {
    const chapter = `Chapter ${Math.floor((i - 1) / 10) + 1}`;
    sceneLines.push(
      `${i}\tMira Holt\tScene ${i} pushes the story forward\t${1000 + i * 10}\t${chapter}`,
    );
  }
  const pasteText = sceneLines.join("\n");
  await page.locator(".sl-step-row").filter({ hasText: "Scene list" }).click();
  await page.getByRole("button", { name: /Paste from clipboard/ }).click();
  await page.getByRole("textbox", { name: "Paste a scene list" }).fill(pasteText);
  await page.getByRole("button", { name: "Create scenes from list" }).click();
  await page.getByText(/40 created/).waitFor();
  await page.screenshot({ path: join(shotDir, "10-step8-import.png"), fullPage: true });

  // 4i. Re-import the same list: merge by line — zero created, 40 updated, no duplicates. The
  // second click lands right after the first import's invalidation storm, so retry with a
  // diagnostic dump instead of a bare wait: a swallowed report and a real merge failure look the
  // same in a timeout.
  let merged = false;
  for (let attempt = 0; attempt < 3 && !merged; attempt++) {
    await page.getByRole("textbox", { name: "Paste a scene list" }).fill(pasteText);
    await page.getByRole("button", { name: "Create scenes from list" }).click();
    try {
      await page.getByText(/40 updated/).waitFor({ timeout: 15000 });
      merged = true;
    } catch {
      const sheetText = await page
        .locator(".sl-sheet")
        .innerText()
        .catch(() => "<no sheet>");
      const rows = await page.evaluate(async () => {
        const session = window.__starlineDev.session();
        return session.driver.query(
          "SELECT COUNT(*) AS n, SUM(CASE WHEN snowflake_source IS NULL THEN 1 ELSE 0 END) AS no_source FROM scene",
        );
      });
      console.log(
        `  merge attempt ${attempt + 1}: sheet "${sheetText.replace(/\n/g, " | ").slice(0, 220)}" rows=${JSON.stringify(rows)}`,
      );
      await page.waitForTimeout(1500);
    }
  }
  if (!merged) throw new Error("the re-import never reported updates");
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.getByText("48,200 est. words").waitFor();
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("7 of 9 steps complete").waitFor();

  // 4j. Scenes tab: 40 rows, reorder via the row menu, reassign to another chapter.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page
    .getByText(/40 scenes/)
    .first()
    .waitFor();
  await page.getByRole("button", { name: "⋯ Scene 2 pushes the story forward" }).click();
  await page.getByRole("button", { name: /Move up/ }).click();
  await page
    .locator(".sl-scene-line-main")
    .first()
    .getByText(/Scene 2 pushes/)
    .waitFor();
  await page.getByRole("button", { name: "⋯ Scene 2 pushes the story forward" }).click();
  await page.getByRole("button", { name: /Move to chapter/ }).click();
  await page.getByRole("button", { name: "Chapter 2", exact: true }).click();
  await page.getByText("11 scenes").first().waitFor();
  await page.screenshot({ path: join(shotDir, "11-scenes-tab.png"), fullPage: true });

  // 4k. Scene editor round-trip: title, objective and outcome persist through a reopen.
  await page.locator(".sl-scene-line-main").filter({ hasText: "Scene 3 pushes" }).click();
  await page.getByLabel("Title").fill("The Ferry");
  await page.getByLabel("Objective").fill("Reach the customs office before the tide");
  await page.getByRole("button", { name: "Yes, but" }).click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Close" }).last().click();
  await page.locator(".sl-scene-line-main").filter({ hasText: "The Ferry" }).click();
  const objective = await page.getByLabel("Objective").inputValue();
  if (objective !== "Reach the customs office before the tide") {
    throw new Error(`scene editor did not round-trip the objective: ${objective}`);
  }
  const outcomePressed = await page
    .getByRole("button", { name: "Yes, but" })
    .getAttribute("aria-pressed");
  if (outcomePressed !== "true") throw new Error("scene editor did not round-trip the outcome");
  await page.screenshot({ path: join(shotDir, "12-scene-sheet.png"), fullPage: true });
  await page.getByRole("button", { name: "Close" }).last().click();

  // 4l. Slice 5 — step 9 accordion: expand a scene, copy the step-8 line into its synopsis,
  // complete the step.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.locator(".sl-step-row").filter({ hasText: "Scene narratives" }).click();
  await page.getByText(/of 40 expanded/).waitFor();
  await page.locator(".sl-scene-line-main").first().click();
  await page.getByRole("button", { name: /Copy step-8 line/ }).click();
  await page
    .getByText(/Step-8 line copied in as the first paragraph|already opens this synopsis/)
    .waitFor();
  await page.screenshot({ path: join(shotDir, "13-step9.png"), fullPage: true });
  await axeScan("step9");
  // The completion click can land while the step-9 editor is still flushing its expand-autosave
  // and the plan behind it re-renders; a single swallowed tap used to fail the whole run with no
  // diagnostic at all. Retry, and on a real failure print what the step rows actually say.
  let stepNineDone = false;
  for (let attempt = 0; attempt < 3 && !stepNineDone; attempt++) {
    const button = page.getByRole("button", { name: "Mark step complete" });
    if ((await button.count()) > 0)
      await button
        .first()
        .click()
        .catch(() => {});
    try {
      await page.getByText("8 of 9 steps complete").waitFor({ timeout: 20000 });
      stepNineDone = true;
    } catch {
      const rows = await page.evaluate(async () => {
        const session = window.__starlineDev.session();
        return session.driver.query("SELECT step, status FROM snowflake_step ORDER BY step");
      });
      console.log(
        `  step-9 completion attempt ${attempt + 1} did not reach the plan: ${JSON.stringify(rows)}`,
      );
      await page.waitForTimeout(1500);
    }
  }
  if (!stepNineDone) throw new Error("step 9 never reported complete");

  // 4m. Dashboard: counts, word estimate, continue list, planned chip, manual snapshot.
  await page.getByText(/\d+ characters? · 40 scenes/).waitFor();
  await page
    .getByText(/≈ [\d,]+/)
    .first()
    .waitFor();
  await page.getByText("Continue where you left off").waitFor();
  await page.getByText(/Planned/).waitFor();
  await page.getByRole("button", { name: "Snapshot now" }).click();
  await page.getByText(/Last backup/).waitFor();
  // Snapshot temps must not leak pool slots: the sahpool is a fixed-size set of files, and a
  // leaked `snap-tmp-*` file eventually makes the library unopenable ("SAH pool is full").
  const poolBefore = await page.evaluate(() => window.__starlineDev.poolStats());
  await page.getByRole("button", { name: "Snapshot now" }).click();
  // Poll: an in-flight snapshot legitimately holds a snap-tmp file for a moment; a leaked one
  // never disappears.
  let poolAfter = poolBefore;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(250);
    poolAfter = await page.evaluate(() => window.__starlineDev.poolStats());
    if (!poolAfter.files.some((name) => /snap-tmp-/.test(name))) break;
  }
  const leaked = poolAfter.files.filter((name) => /snap-tmp-/.test(name));
  if (leaked.length > 0) throw new Error(`snapshot temp files leaked into the pool: ${leaked}`);
  if (poolAfter.fileCount > poolBefore.fileCount)
    throw new Error(
      `pool file count grew across snapshots: ${poolBefore.fileCount} → ${poolAfter.fileCount}`,
    );
  console.log(
    `  pool: ${poolAfter.fileCount}/${poolAfter.capacity} slots used, files=${JSON.stringify(poolAfter.files)}`,
  );
  await page.screenshot({ path: join(shotDir, "14-dashboard.png"), fullPage: true });
  await axeScan("plan");

  // 4n. Trash round-trip: delete a scene, restore it from the Trash screen.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page.getByRole("button", { name: "⋯ The Ferry" }).click();
  await page.getByRole("button", { name: "✕ Delete", exact: true }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("button", { name: /^Trash/ }).click();
  await page.getByRole("heading", { name: "Trash" }).waitFor();
  await page.getByText("The Ferry").waitFor();
  await page.screenshot({ path: join(shotDir, "15-trash.png"), fullPage: true });
  await axeScan("trash");
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByText("Nothing in the trash.").waitFor();
  // Let the 4n delete toast expire before the next undo test — otherwise its Undo button is
  // still the pending action and would absorb the next click (it restores the already-restored
  // scene and the second delete would silently stay in the trash).
  await page.getByRole("button", { name: "Undo" }).waitFor({ state: "hidden", timeout: 15000 });

  // 4o. Undo toast: delete a scene and bring it back from the toast.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page.getByRole("button", { name: "⋯ Scene 5 pushes the story forward" }).click();
  await page.getByRole("button", { name: "✕ Delete", exact: true }).click();
  await page.getByRole("button", { name: "Tap again to delete" }).click();
  await page.getByText("Scene deleted").waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(700);
  await page.locator(".sl-scene-line-main").filter({ hasText: "Scene 5 pushes" }).waitFor();
  // The toast clears on undo — wait it out so no pending action leaks into the drag step.
  await page.getByRole("button", { name: "Undo" }).waitFor({ state: "hidden", timeout: 15000 });

  // 4p. Long-press drag: reorder the first row below the second with a mouse drag.
  const rows = page.locator(".sl-scene-line-main");
  const beforeDrag = await rows.nth(0).innerText();
  const firstBox = await rows.nth(0).boundingBox();
  const secondBox = await rows.nth(1).boundingBox();
  if (firstBox === null || secondBox === null) throw new Error("scene rows not measurable");
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2, secondBox.y + secondBox.height / 2, {
    steps: 14,
  });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(800);
  const afterDrag = await rows.nth(0).innerText();
  if (beforeDrag === afterDrag) throw new Error("drag reorder did not move the row");
  await page.screenshot({ path: join(shotDir, "16-drag.png"), fullPage: true });
  await axeScan("scenes");
  // Let the drag's "Scene moved" toast expire: the toast is single-slot, so a stale one would
  // absorb the lore undo below.
  await page.getByRole("button", { name: "Undo" }).waitFor({ state: "hidden", timeout: 15000 });

  // 4q. World tab (slice 6): seeded taxonomy, entry CRUD, kind-template fields, @-mentions,
  // delete → undo. The lore wiki is the first slice where an entity can link to another.
  await page.getByRole("link", { name: "World" }).click();
  await page.getByRole("heading", { name: "World" }).waitFor();
  await page.locator(".sl-tree-row").filter({ hasText: "Geography" }).waitFor();
  await page.locator(".sl-tree-row").filter({ hasText: "Magic & Technology" }).waitFor();
  await page.locator(".sl-tree-row").filter({ hasText: "Geography" }).click();

  const addEntry = async (name) => {
    await page.getByPlaceholder("Entry name").fill(name);
    await page.getByRole("button", { name: "New entry", exact: true }).click();
    await page.locator(".sl-lore-card").filter({ hasText: name }).first().waitFor();
  };
  await addEntry("The Sundered Coast");
  await addEntry("Emberfall");

  // The kind template (geography) seeds its fields on first entry of that kind.
  await page.locator(".sl-lore-card").filter({ hasText: "Emberfall" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Emberfall" });
  await sheet.waitFor();
  await sheet.getByLabel("Climate").waitFor();
  await sheet.getByLabel("Summary").fill("A harbour town on the glass sea");
  const body = sheet.locator(".sl-editor-body .ProseMirror");
  await body.click();
  await page.keyboard.type("North of the ruins lies ");
  await page.keyboard.type("@Emb");
  await page
    .locator(".sl-mention-popup .sl-mention-row")
    .filter({ hasText: "Emberfall" })
    .waitFor();
  await page.locator(".sl-mention-popup .sl-mention-row").filter({ hasText: "Emberfall" }).click();
  await sheet.locator(".sl-mention-chip").filter({ hasText: "Emberfall" }).waitFor();
  await page.waitForTimeout(1200);
  const rowAfterBody = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    return session.driver.query("SELECT name, summary, body_text FROM lore_entry ORDER BY name");
  });
  console.log(`  lore rows after body edit: ${JSON.stringify(rowAfterBody)}`);
  await page.screenshot({ path: join(shotDir, "17-lore-sheet.png"), fullPage: true });
  await axeScan("lore");
  await sheet.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(900);

  // Persistence: reopening shows the summary and the mention chip (ids, not names).
  await page.locator(".sl-lore-card").filter({ hasText: "Emberfall" }).first().click();
  const reopened = page.getByRole("dialog", { name: "Emberfall" });
  await reopened.waitFor();
  await reopened.getByLabel("Summary").waitFor();
  const rowOnReopen = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    return session.driver.query("SELECT name, summary FROM lore_entry ORDER BY name");
  });
  console.log(`  lore rows on reopen: ${JSON.stringify(rowOnReopen)}`);
  const summaryValue = await reopened.getByLabel("Summary").inputValue();
  if (summaryValue !== "A harbour town on the glass sea")
    throw new Error(`lore summary did not persist: "${summaryValue}"`);
  await reopened.locator(".sl-mention-chip").filter({ hasText: "Emberfall" }).waitFor();

  // Delete → undo toast → the entry comes back (trash now covers lore entries too).
  await reopened.getByRole("button", { name: "Delete entry" }).click();
  await reopened.getByRole("button", { name: "Tap again to delete" }).click();
  await page.getByText("Entry deleted").waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForTimeout(700);
  await page.locator(".sl-lore-card").filter({ hasText: "Emberfall" }).first().waitFor();
  await page.getByRole("button", { name: "Undo" }).waitFor({ state: "hidden", timeout: 15000 });
  await axeScan("world");

  // 4r. Slice 7: backlinks, possible mentions (one-tap Link), global search, checks screen,
  // and the phone-path perf budgets measured through the real wasm driver in this page.
  await page.locator(".sl-lore-card").filter({ hasText: "The Sundered Coast" }).first().click();
  const coast = page.getByRole("dialog", { name: "The Sundered Coast" });
  await coast.waitFor();
  const coastBody = coast.locator(".sl-editor-body .ProseMirror");
  await coastBody.click();
  // Plain text on purpose: this is the unlinked occurrence the "Link" button rewrites.
  await page.keyboard.type("Emberfall is west of the strait.");
  await page.waitForTimeout(1200);
  await coast.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(600);

  await page.locator(".sl-lore-card").filter({ hasText: "Emberfall" }).first().click();
  const ember = page.getByRole("dialog", { name: "Emberfall" });
  await ember.waitFor();
  const backlinkRows = page.locator('[data-testid="sl-backlinks"] .sl-backlink-row');
  await backlinkRows.first().waitFor();
  const possibleRows = page.locator('[data-testid="sl-possible-mentions"] .sl-possible-row');
  await possibleRows.first().waitFor();
  const beforeLinks = await backlinkRows.count();
  const beforePossible = await possibleRows.count();
  console.log(`  backlinks before: ${beforeLinks} · possible mentions: ${beforePossible}`);
  await page.screenshot({ path: join(shotDir, "18-backlinks.png"), fullPage: true });

  // One-tap Link: the plain range becomes a chip, the mirror gains the source, text intact.
  await possibleRows.first().getByRole("button", { name: "Link" }).click();
  await page.waitForTimeout(900);
  await page.getByText("Mention linked").waitFor();
  const afterPossible = await page
    .locator('[data-testid="sl-possible-mentions"] .sl-possible-row')
    .count();
  const afterLinks = await page.locator('[data-testid="sl-backlinks"] .sl-backlink-row').count();
  if (afterPossible >= beforePossible) throw new Error("possible mention was not consumed by Link");
  if (afterLinks <= beforeLinks) throw new Error("linking did not add a backlink");
  const coastText = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT body_text FROM lore_entry WHERE name = 'The Sundered Coast'",
    );
    return rows[0]?.body_text ?? "";
  });
  if (!coastText.includes("Emberfall is west of the strait."))
    throw new Error(`link rewrite damaged the prose: "${coastText}"`);
  await ember.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(500);

  // Global search: the app-bar button opens the sheet; a fuzzy-ish prefix finds the entry.
  await page.getByTestId("sl-search-open").click();
  const searchInput = page.locator("#sl-search-input");
  await searchInput.waitFor();
  await searchInput.fill("Ember");
  const hit = page
    .locator('.sl-search-hit[data-entity-type="lore"]')
    .filter({ hasText: "Emberfall" });
  await hit.first().waitFor();
  await page.screenshot({ path: join(shotDir, "19-search.png"), fullPage: true });
  await axeScan("search");
  await hit.first().click();
  await page.getByRole("dialog", { name: "Emberfall" }).waitFor();
  await page
    .getByRole("dialog", { name: "Emberfall" })
    .getByRole("button", { name: "Close" })
    .click();
  await page.waitForTimeout(400);

  // Checks screen: advisory list, reachable from the plan dashboard.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-checks-open").click();
  await page.getByRole("heading", { name: "Consistency checks" }).waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shotDir, "20-checks.png"), fullPage: true });
  await axeScan("checks");
  await page.getByRole("link", { name: "Plan" }).click();

  // 4s. Slice 8: the relationship matrix, the web and the edge sheet — create an edge from the
  // matrix, edit it, see it in the graph, pin a node, and read the list twin.
  await page.getByRole("link", { name: "People" }).click();
  // The matrix needs a pair; the journey's step 3 usually leaves one character behind.
  const characterCount = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT COUNT(*) AS total FROM character WHERE deleted_at IS NULL",
    );
    return Number(rows[0]?.total ?? 0);
  });
  if (characterCount < 2) {
    await page.getByPlaceholder("Quick add — name").fill("Tor Halden");
    await page.getByRole("button", { name: "Add character" }).click();
    await page.waitForTimeout(900);
  }
  await page.getByTestId("sl-mode-matrix").click();
  const matrix = page.getByTestId("sl-matrix");
  await matrix.waitFor({ timeout: 30000 });
  const emptyCells = await page.locator('.sl-matrix-cell[data-filled="false"]').count();
  console.log(`  matrix cells: ${emptyCells} empty`);
  await page.screenshot({ path: join(shotDir, "21-matrix.png"), fullPage: true });
  await axeScan("matrix");

  // Create from a cell: tap an empty cell, the sheet opens with the pair prefilled.
  await page.locator('.sl-matrix-cell[data-filled="false"]').first().click();
  const edgeSheet = page.getByTestId("sl-edge-sheet");
  await edgeSheet.waitFor();
  const fromValue = await edgeSheet.getByLabel("From", { exact: true }).inputValue();
  const toValue = await edgeSheet.getByLabel("To", { exact: true }).inputValue();
  if (fromValue === "" || toValue === "" || fromValue === toValue) {
    throw new Error("matrix cell did not prefill the pair");
  }
  await edgeSheet.getByLabel("Kind", { exact: true }).selectOption("family_sibling");
  await edgeSheet.getByTestId("sl-edge-sentiment").fill("4");
  await edgeSheet.getByTestId("sl-edge-secret").check();
  await page.screenshot({ path: join(shotDir, "22-edge-sheet.png"), fullPage: true });
  await edgeSheet.getByTestId("sl-edge-save").click();
  await edgeSheet.waitFor({ state: "detached", timeout: 15000 });

  const created = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const rows = await session.driver.query(
      "SELECT kind, sentiment, secret, directed, source_id, target_id FROM character_relationship WHERE deleted_at IS NULL",
    );
    return { projectId: projects[0].id, rows };
  });
  const sibling = created.rows.find((row) => row.kind === "family_sibling");
  if (!sibling) throw new Error("the edge was not written");
  if (Number(sibling.sentiment) !== 4)
    throw new Error(`sentiment not stored: ${sibling.sentiment}`);
  if (Number(sibling.secret) !== 1) throw new Error("secret flag not stored");
  if (Number(sibling.directed) !== 0)
    throw new Error("family_sibling should default to undirected");
  if (!(sibling.source_id < sibling.target_id))
    throw new Error("undirected edge was not normalised");

  // The matrix cell now shows the kind glyph; tapping it reopens the same edge for editing.
  const filled = page.locator('.sl-matrix-cell[data-filled="true"]').first();
  await filled.waitFor({ timeout: 15000 });
  await filled.click();
  const editSheet = page.getByTestId("sl-edge-sheet");
  await editSheet.waitFor();
  await editSheet.getByTestId("sl-edge-sentiment").fill("-3");
  await editSheet.getByTestId("sl-edge-save").click();
  await editSheet.waitFor({ state: "detached", timeout: 15000 });
  const edited = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT sentiment FROM character_relationship WHERE kind = 'family_sibling' AND deleted_at IS NULL",
    );
    return rows[0]?.sentiment ?? null;
  });
  if (Number(edited) !== -3) throw new Error(`edit did not land: ${edited}`);

  // Groups: create one from the sheet, then read it back through the dev hook.
  await page.getByTestId("sl-rel-groups").click();
  const groupSheet = page.getByTestId("sl-group-sheet");
  await groupSheet.waitFor();
  await groupSheet.getByLabel("Group", { exact: true }).first().fill("House Voss");
  await groupSheet.getByTestId("sl-group-add").click();
  await page.waitForTimeout(800);
  const groups = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    return session.driver.query("SELECT name FROM relationship_group WHERE deleted_at IS NULL");
  });
  if (!groups.some((row) => row.name === "House Voss")) throw new Error("group was not created");
  await groupSheet.getByRole("button", { name: "Close" }).click();
  await page.waitForTimeout(400);

  // The web: nodes render, a node drag pins it, and the list twin is keyboard-readable.
  await page.getByTestId("sl-mode-graph").click();
  const graph = page.getByTestId("sl-graph");
  await graph.waitFor({ timeout: 30000 });
  const graphNodes = page.locator(".sl-graph-node");
  await graphNodes.first().waitFor({ timeout: 30000 });
  const nodeCount = await graphNodes.count();
  if (nodeCount < 2) throw new Error(`graph rendered ${nodeCount} nodes`);
  console.log(`  graph nodes: ${nodeCount}`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shotDir, "23-graph.png"), fullPage: true });

  // Drag the first node and assert the pin reached meta.graph_positions.
  const box = await graphNodes.first().boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const pins = await page.evaluate(
      async (projectId) => window.__starlineDev.graphPositions(projectId),
      created.projectId,
    );
    const pinCount = Object.keys(pins).length;
    console.log(`  pins after drag: ${pinCount}`);
    if (pinCount === 0) throw new Error("dragging a node did not pin it");
  }

  await page.getByTestId("sl-graph-list-toggle").click();
  const listRows = page.locator('[data-testid="sl-rel-list"] tbody tr');
  await listRows.first().waitFor({ timeout: 15000 });
  const listCount = await listRows.count();
  if (listCount === 0) throw new Error("list twin rendered no rows");
  console.log(`  list twin rows: ${listCount}`);
  await page.getByTestId("sl-graph-list-toggle").click();
  await page.waitForTimeout(600);
  await axeScan("graph");
  await page.getByRole("link", { name: "Plan" }).click();

  // 4t. Slice 9: the plotline grid (attach a scene, edit its beat, read the balance), the tag
  // manager (create, rename, recolour, merge, delete) and a custom field that appears on an
  // existing scene the moment it is created — the slice's three exit criteria.
  await page.getByRole("link", { name: "Scenes" }).click();
  await page.getByTestId("sl-scenes-grid").click();
  // The canvas only renders once a plotline exists, so create the first row before waiting.
  await page.getByTestId("sl-grid-new-plotline").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-grid-new-plotline").fill("The debt");
  await page.getByTestId("sl-grid-add-plotline").click();
  await page.getByTestId("sl-grid-cell").first().waitFor({ timeout: 30000 });
  console.log(`  grid cells rendered: ${await page.getByTestId("sl-grid-cell").count()}`);
  await page.getByTestId("sl-grid-cell").first().click();
  await page.waitForTimeout(900);
  const attached = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const grid = await window.__starlineDev.grid(projects[0].id);
    return Object.keys(grid.cells).length;
  });
  if (attached !== 1) throw new Error(`grid attach did not persist (${attached} cells)`);
  console.log("  grid: cell attached and persisted");

  await page.getByTestId("sl-grid-cell").first().click();
  await page.getByTestId("sl-grid-beat-input").waitFor({ timeout: 20000 });
  await page.getByTestId("sl-grid-beat-input").fill("The letter arrives");
  await page.getByTestId("sl-grid-beat-save").click();
  await page.waitForTimeout(900);
  const beat = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const grid = await window.__starlineDev.grid(projects[0].id);
    return Object.values(grid.cells)[0]?.beat ?? "";
  });
  if (beat !== "The letter arrives") throw new Error(`beat not stored: "${beat}"`);
  const balanceText = await page.getByTestId("sl-grid-balance").first().innerText();
  console.log(`  grid balance: ${balanceText}`);
  if (!/^1 of \d+ scenes; longest gap 0$/.test(balanceText.trim())) {
    throw new Error(`balance line looks wrong: ${balanceText}`);
  }
  const zoomBefore = await page.getByTestId("sl-grid-zoom-reset").innerText();
  await page.getByTestId("sl-grid-zoom-in").click();
  await page.waitForTimeout(300);
  const zoomAfter = await page.getByTestId("sl-grid-zoom-reset").innerText();
  if (zoomBefore === zoomAfter) throw new Error("grid zoom control did nothing");
  console.log(`  grid zoom: ${zoomBefore.trim()} → ${zoomAfter.trim()}`);
  await page.screenshot({ path: join(shotDir, "17-grid.png"), fullPage: true });
  await axeScan("grid");

  // Tag manager (Settings → Tags).
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-settings").click();
  await page.getByTestId("sl-tag-name-input").waitFor({ timeout: 20000 });
  await page.getByTestId("sl-tag-name-input").fill("red herring");
  await page.getByTestId("sl-tag-create").click();
  await page.getByTestId("sl-tag-row").first().waitFor({ timeout: 20000 });

  await page.getByTestId("sl-tag-name").first().click();
  await page.getByTestId("sl-tag-rename-input").fill("mystery");
  await page.getByTestId("sl-tag-rename-input").press("Enter");
  await page.waitForTimeout(800);
  await page.getByTestId("sl-tag-color").nth(3).click();
  await page.waitForTimeout(700);

  await page.getByTestId("sl-tag-name-input").fill("arc");
  await page.getByTestId("sl-tag-create").click();
  await page.waitForTimeout(900);
  const mysteryRow = page.getByTestId("sl-tag-row").filter({ hasText: "mystery" });
  await mysteryRow.getByTestId("sl-tag-merge").click();
  await mysteryRow.getByTestId("sl-tag-merge-target").selectOption({ label: "arc" });
  await mysteryRow.getByTestId("sl-tag-merge-confirm").click();
  await page.waitForTimeout(900);
  const afterMerge = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    return window.__starlineDev.tags(projects[0].id);
  });
  if (afterMerge.length !== 1 || afterMerge[0].name !== "arc") {
    throw new Error(`merge left ${JSON.stringify(afterMerge)}`);
  }
  console.log(`  tags after merge: ${afterMerge.map((tag) => tag.name).join(", ")}`);
  await page.screenshot({ path: join(shotDir, "18-tags.png"), fullPage: true });
  await axeScan("settings");

  // Custom fields: a new scene field lands on every existing scene straight away.
  await page.getByTestId("sl-settings-fields").click();
  await page.getByTestId("sl-field-target").selectOption("scene");
  await page.getByTestId("sl-field-label").fill("Tension");
  await page.getByTestId("sl-field-type").selectOption("number");
  await page.getByTestId("sl-field-add").click();
  // Scope every read to the row we just made: the lore kind templates are in the same list.
  const tensionRow = page.getByTestId("sl-field-row").filter({ hasText: "Tension" });
  await tensionRow.waitFor({ timeout: 20000 });
  const usageBefore = await tensionRow.getByTestId("sl-field-usage").innerText();

  await page.getByRole("link", { name: "Scenes" }).click();
  await page.getByTestId("sl-scenes-list").click();
  await page.locator(".sl-scene-line-main").first().click();
  await page.getByTestId("sl-custom-fields").waitFor({ timeout: 20000 });
  const tension = page.getByLabel("Tension", { exact: true });
  await tension.fill("7");
  await tension.blur();
  await page.waitForTimeout(900);
  const stored = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT value FROM custom_field_value WHERE owner_type = 'scene'",
    );
    return rows.map((row) => row.value);
  });
  if (!stored.includes("7")) throw new Error(`scene field not stored: ${JSON.stringify(stored)}`);
  console.log(
    `  custom field on an existing scene: usage before "${usageBefore.trim()}", stored ${JSON.stringify(stored)}`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // The settings list now counts that fill.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-settings").click();
  await page.getByTestId("sl-settings-fields").click();
  // The list renders from cache first and the count arrives with the refetch, so wait for the
  // number itself instead of reading the first paint (that flaked once).
  const usageCell = page
    .getByTestId("sl-field-row")
    .filter({ hasText: "Tension" })
    .getByTestId("sl-field-usage");
  await usageCell.filter({ hasText: "1" }).waitFor({ timeout: 20000 });
  const usageAfter = await usageCell.innerText();
  if (!/1/.test(usageAfter)) throw new Error(`usage count did not update: ${usageAfter}`);
  console.log(`  field usage after the fill: ${usageAfter.trim()}`);
  await page.getByRole("link", { name: "Plan" }).click();

  // 4u. Slice 10: the timeline — place a scene from the no-time tray, add a world event, drag a
  // block to a new story time (asserted against the row, not the pixels) and zoom the axis.
  await page.getByRole("link", { name: "World" }).click();
  await page.getByTestId("sl-world-timeline").click();
  // The tray card paints before the timeline query lands, so wait for a ROW, not the card.
  await page.getByTestId("sl-tray-row").first().waitFor({ timeout: 30000 });
  const trayRows = await page.getByTestId("sl-tray-row").count();
  if (trayRows === 0) throw new Error("no-time tray is empty on a fresh timeline");
  console.log(`  timeline tray rows: ${trayRows}`);

  await page.getByTestId("sl-tray-input").first().fill("1247-03-12");
  await page.getByTestId("sl-tray-place").first().click();
  await page.waitForTimeout(1200);
  const placed = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const projects = await session.driver.query("SELECT id FROM project LIMIT 1");
    const timeline = await window.__starlineDev.timeline(projects[0].id);
    const rows = await session.driver.query(
      "SELECT story_time FROM scene WHERE story_time IS NOT NULL AND deleted_at IS NULL",
    );
    return { noTime: timeline.noTime.length, placedRows: rows.length, first: rows[0]?.story_time };
  });
  if (placed.placedRows !== 1) throw new Error(`tray place did not persist (${placed.placedRows})`);
  if (!Number.isFinite(Number(placed.first)) || Number(placed.first) <= 0) {
    throw new Error(`story time looks wrong: ${placed.first}`);
  }
  console.log(`  timeline: scene placed at story time ${placed.first}, tray now ${placed.noTime}`);
  await page.getByTestId("sl-timeline-block").first().waitFor({ timeout: 20000 });

  // A world event, created through the sheet.
  await page.getByTestId("sl-timeline-add-event").click();
  await page.getByTestId("sl-event-sheet").waitFor({ timeout: 20000 });
  await page.getByTestId("sl-event-title").fill("The comet falls");
  await page.getByTestId("sl-event-time").fill("1247-03-12 20:00");
  await page.getByTestId("sl-event-label").fill("the night of the storm");
  await page.getByTestId("sl-event-save").click();
  await page.waitForTimeout(1200);
  const events = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT title, story_time_label, lane FROM timeline_event WHERE deleted_at IS NULL",
    );
    return rows;
  });
  if (events.length !== 1 || events[0].title !== "The comet falls") {
    throw new Error(`event not stored: ${JSON.stringify(events)}`);
  }
  if (events[0].lane !== "world") throw new Error(`event landed in lane ${events[0].lane}`);
  console.log(`  timeline event: "${events[0].title}" in the world lane`);

  // Drag the scene block to a new time. Zoom to days first so the gesture is human-sized.
  await page.getByTestId("sl-timeline-zoom").selectOption("days");
  await page.waitForTimeout(400);
  const before = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT id, story_time FROM scene WHERE story_time IS NOT NULL AND deleted_at IS NULL",
    );
    return rows[0];
  });
  const sceneBlock = page.locator('[data-testid="sl-timeline-block"][data-kind="scene"]').first();
  await sceneBlock.scrollIntoViewIfNeeded();
  const blockBox = await sceneBlock.boundingBox();
  if (blockBox === null) throw new Error("scene block has no box");
  await page.mouse.move(
    blockBox.x + Math.min(20, blockBox.width / 2),
    blockBox.y + blockBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(blockBox.x + 240, blockBox.y + blockBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const after = await page.evaluate(async (sceneId) => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT story_time FROM scene WHERE id = ?", [sceneId]);
    return rows[0]?.story_time;
  }, before.id);
  if (Number(after) === Number(before.story_time)) {
    throw new Error("dragging the block did not change the story time");
  }
  console.log(`  timeline drag: ${before.story_time} → ${after}`);
  await page.screenshot({ path: join(shotDir, "19-timeline.png"), fullPage: true });
  await axeScan("timeline");

  // Zoom changes the axis labels.
  await page.getByTestId("sl-timeline-zoom").selectOption("years");
  await page.waitForTimeout(500);
  const yearTicks = await page.getByTestId("sl-timeline-axis").innerText();
  await page.getByTestId("sl-timeline-zoom").selectOption("hours");
  await page.waitForTimeout(500);
  const hourTicks = await page.getByTestId("sl-timeline-axis").innerText();
  if (yearTicks === hourTicks) throw new Error("zoom did not change the axis labels");
  console.log(
    `  timeline zoom: "${yearTicks.replace(/\s+/g, " ").trim()}" → "${hourTicks.replace(/\s+/g, " ").trim()}"`,
  );
  await page.getByTestId("sl-timeline-zoom").selectOption("years");
  await page.getByRole("link", { name: "Plan" }).click();

  // 4v. Slice 11: backups — snapshot now, make a destructive change, preview what the snapshot
  // would bring back, restore it, then copy one scene back out of the pre-restore snapshot.
  await page.getByTestId("sl-open-backups").click();
  await page.getByTestId("sl-backup-now").waitFor({ timeout: 30000 });
  await page.getByTestId("sl-backup-now").click();
  await page.getByTestId("sl-backup-row").first().waitFor({ timeout: 30000 });
  const listedSnapshots = await page.getByTestId("sl-backup-row").count();
  if (listedSnapshots < 1) throw new Error("Snapshot now listed no snapshot");
  console.log(`  backups: ${listedSnapshots} snapshot(s) after Snapshot now`);

  const sceneCount = () =>
    page.evaluate(async () => {
      const session = window.__starlineDev.session();
      const rows = await session.driver.query(
        "SELECT COUNT(*) AS n FROM scene WHERE deleted_at IS NULL",
      );
      return rows[0].n;
    });
  const scenesBefore = await sceneCount();
  const projectId = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT id FROM project LIMIT 1");
    return rows[0].id;
  });
  await page.evaluate(async (id) => {
    for (const title of ["Regret one", "Regret two", "Regret three"]) {
      await window.__starlineDev.run("createScene", { projectId: id, title });
    }
  }, projectId);
  const scenesAfter = await sceneCount();
  if (scenesAfter !== scenesBefore + 3) {
    throw new Error(`the destructive change did not land (${scenesBefore} → ${scenesAfter})`);
  }

  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-backups").click();
  await page.getByTestId("sl-backup-row").first().waitFor({ timeout: 30000 });
  await page.getByTestId("sl-backup-preview").first().click();
  await page.getByTestId("sl-backup-preview-sheet").waitFor({ timeout: 30000 });
  const diffSummary = (await page.getByTestId("sl-diff-summary").innerText()).trim();
  if (!diffSummary.includes("+3 scenes")) {
    throw new Error(`preview diff does not show the three new scenes: "${diffSummary}"`);
  }
  console.log(`  backups preview diff: "${diffSummary}"`);
  await axeScan("backups");
  await page.screenshot({ path: join(shotDir, "20-backups-preview.png"), fullPage: true });

  // Restore: the three scenes must be gone again, and the app must come back on the plan.
  await page.locator(".sl-sheet-backdrop").click();
  await page.waitForTimeout(300);
  await page.getByTestId("sl-backup-restore").first().click();
  await page.getByTestId("sl-restore-confirm").waitFor({ timeout: 20000 });
  await page.getByTestId("sl-restore-confirm-yes").click();
  await page.getByTestId("sl-open-settings").waitFor({ timeout: 90000 });
  const restored = await sceneCount();
  if (restored !== scenesBefore) {
    throw new Error(`restore did not roll the library back (${scenesAfter} → ${restored})`);
  }
  console.log(`  backups restore: ${scenesAfter} → ${restored} scenes`);

  // The pool must not leak a duplicate file for the replaced library (the restore bug this
  // step exists to catch) nor leave snapshot temps behind.
  const poolAfterRestore = await page.evaluate(() => window.__starlineDev.poolStats());
  const libraryFiles = poolAfterRestore.files.filter(
    (name) => !/journal|wal|shm/.test(name) && !/snap-tmp-/.test(name),
  );
  if (libraryFiles.length !== 1) {
    throw new Error(`pool holds ${libraryFiles.length} libraries after a restore: ${libraryFiles}`);
  }
  if (poolAfterRestore.files.some((name) => name.includes("snap-tmp-"))) {
    throw new Error(`restore leaked a snapshot temp: ${poolAfterRestore.files}`);
  }

  // Single-entity restore: the pre-restore guard snapshot still holds the three scenes; copy
  // one of them back into the restored library.
  await page.getByTestId("sl-open-backups").click();
  await page.getByTestId("sl-backup-row").first().waitFor({ timeout: 60000 });
  const guardRow = page.getByTestId("sl-backup-row").filter({ hasText: "BEFORE RESTORE" }).first();
  await guardRow.getByTestId("sl-backup-preview").click();
  await page.getByTestId("sl-backup-preview-sheet").waitFor({ timeout: 30000 });
  const options = await page.getByTestId("sl-entity-pick").locator("option").allInnerTexts();
  const wanted = options.find((option) => option.includes("Regret two"));
  if (wanted === undefined) {
    throw new Error(`the guard snapshot offers no scene to restore: ${JSON.stringify(options)}`);
  }
  await page.getByTestId("sl-entity-pick").selectOption({ label: wanted });
  await page.getByTestId("sl-entity-restore").click();
  await page.waitForTimeout(2000);
  const afterEntity = await sceneCount();
  if (afterEntity !== restored + 1) {
    throw new Error(`single-entity restore did not add the scene (${restored} → ${afterEntity})`);
  }
  console.log(`  backups single-entity restore: "${wanted}" → ${afterEntity} scenes`);
  await axeScan("backups-entity");
  await page.screenshot({ path: join(shotDir, "21-backups-entity.png"), fullPage: true });
  await page.locator(".sl-sheet-backdrop").click();
  await page.getByRole("link", { name: "Plan" }).click();

  // Phone-path budgets (spec §5.1): the same reads the panels run, through the wasm driver.
  const perf = await page.evaluate(async () => {
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
  console.log(
    `  wasm perf: search p50 ${perf.searchP50} ms / p95 ${perf.searchP95} ms · backlinks p50 ${perf.backlinkP50} ms / p95 ${perf.backlinkP95} ms`,
  );
  if (perf.searchP95 > 30)
    throw new Error(`search budget missed on the wasm path: ${perf.searchP95} ms`);
  if (perf.backlinkP95 > 10)
    throw new Error(`backlink budget missed on the wasm path: ${perf.backlinkP95} ms`);

  // 4w. Slice 12: export the project in every format and check what actually came out. Each
  // export runs in its own worker and is saved through the browser download path in this build.
  // An array, not a map: the same format exported twice has the same file name, and the round
  // trip below needs the LAST JSON export, not whichever one won the key.
  const exported = [];
  page.on("download", async (download) => {
    const target = join(exportDir, download.suggestedFilename());
    await download.saveAs(target);
    exported.push({ name: download.suggestedFilename(), path: target });
  });
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-export").click();
  await page.getByTestId("sl-export-panel").waitFor({ timeout: 20000 });
  await axeScan("export");

  async function runExport(preset) {
    await page.getByTestId(`sl-preset-${preset}`).click();
    const before = exported.length;
    await page.getByTestId("sl-export-run").click();
    for (let attempt = 0; attempt < 120 && exported.length === before; attempt++) {
      await page.waitForTimeout(500);
    }
    if (exported.length === before) {
      const shown = await page
        .getByTestId("sl-export-error")
        .textContent()
        .catch(() => "(no error)");
      throw new Error(`export ${preset} produced no file — screen says: ${shown}`);
    }
    const latest = exported.at(-1);
    const bytes = readFileSync(latest.path);
    console.log(`  export ${preset}: ${latest.name} (${(bytes.byteLength / 1024).toFixed(1)} KB)`);
    return { name: latest.name, path: latest.path, bytes };
  }

  const jsonExport = await runExport("json");
  const jsonDocument = JSON.parse(jsonExport.bytes.toString("utf8"));
  const jsonScenes = jsonDocument.scenes.length;
  const jsonCharacters = jsonDocument.characters.length;
  if (jsonScenes < 40) throw new Error(`JSON export carries ${jsonScenes} scenes, expected 40+`);
  if (jsonCharacters < 1) throw new Error("JSON export carries no characters");
  if (jsonDocument.project.title !== "The Cartographer's Sea") {
    throw new Error(`JSON export title is ${JSON.stringify(jsonDocument.project.title)}`);
  }
  console.log(
    `  json: ${jsonCharacters} characters · ${jsonScenes} scenes · format ${jsonDocument.format}`,
  );

  const folderExport = await runExport("markdown-folder");
  const folderFiles = Object.keys(unzipSync(new Uint8Array(folderExport.bytes)));
  if (!folderFiles.some((file) => file.endsWith("starline.json"))) {
    throw new Error("Markdown folder has no starline.json manifest");
  }
  const folderScenes = folderFiles.filter(
    (file) => file.includes("/outline/") && file.endsWith(".md"),
  );
  const folderCharacters = folderFiles.filter((file) => file.includes("/characters/"));
  if (folderScenes.length < 40) {
    throw new Error(`Markdown folder carries ${folderScenes.length} scene files, expected 40+`);
  }
  if (folderCharacters.length < 1) throw new Error("Markdown folder carries no character files");
  console.log(
    `  markdown folder: ${folderFiles.length} files · ${folderScenes.length} scenes · ${folderCharacters.length} characters`,
  );

  const docxExport = await runExport("docx-manuscript");
  const docxZip = unzipSync(new Uint8Array(docxExport.bytes));
  const documentXml = strFromU8(docxZip["word/document.xml"] ?? new Uint8Array());
  for (const part of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/styles.xml",
  ]) {
    if (docxZip[part] === undefined) throw new Error(`DOCX is missing ${part}`);
  }
  // The manuscript preset prints chapters and the scenes that have prose; the planning preset
  // prints the synopses. Chapter 1 and "The Ferry" (the scene written in the editor round-trip)
  // must be in the manuscript, and the step-8 lines must be in the planning document.
  if (!documentXml.includes("Chapter 1") || !documentXml.includes("The Ferry")) {
    throw new Error(`DOCX manuscript does not carry the outline (${documentXml.length} chars)`);
  }
  const planningExport = await runExport("docx-planning");
  const planningXml = strFromU8(
    unzipSync(new Uint8Array(planningExport.bytes))["word/document.xml"] ?? new Uint8Array(),
  );
  if (!planningXml.includes("Scene 1 pushes the story forward")) {
    throw new Error(`DOCX planning document carries no synopses (${planningXml.length} chars)`);
  }
  console.log(
    `  docx: manuscript ${documentXml.length} chars · planning ${planningXml.length} chars · ${Object.keys(docxZip).length} parts`,
  );

  const csvExport = await runExport("csv");
  const csvFiles = unzipSync(new Uint8Array(csvExport.bytes));
  const scenesCsv = strFromU8(csvFiles["scenes.csv"] ?? new Uint8Array());
  const charactersCsv = strFromU8(csvFiles["characters.csv"] ?? new Uint8Array());
  if (scenesCsv.split("\n").length < 41) {
    throw new Error(`scenes.csv has ${scenesCsv.split("\n").length - 1} rows, expected 40`);
  }
  if (!charactersCsv.includes("Mira Holt"))
    throw new Error("characters.csv does not carry Mira Holt");
  console.log(
    `  csv tables: ${Object.keys(csvFiles).length} tables · ${scenesCsv.split("\n").length - 1} scene rows`,
  );

  // The importer's other half: paste a CSV and split a manuscript, both through the real UI.
  await page.getByTestId("sl-mode-csv").click();
  await page
    .getByTestId("sl-csv-text")
    .fill(
      [
        "name,role,one line",
        "Nerissa Quill,supporting,The harbour clerk who keeps two ledgers",
        "Bram Kestrel,minor,The lighthouse keeper nobody believes",
      ].join("\n"),
    );
  await page.getByTestId("sl-csv-check").click();
  await page.getByTestId("sl-csv-summary").waitFor();
  const csvSummary = await page.getByTestId("sl-csv-summary").textContent();
  if (!csvSummary?.includes("2 to create")) {
    throw new Error(`CSV dry run said ${JSON.stringify(csvSummary)}, expected 2 to create`);
  }
  await page.getByTestId("sl-csv-import").click();
  await page.getByTestId("sl-csv-done").waitFor({ timeout: 20000 });
  const csvDone = await page.getByTestId("sl-csv-done").textContent();
  if (!csvDone?.includes("2 created"))
    throw new Error(`CSV import said ${JSON.stringify(csvDone)}`);
  console.log(`  csv import: ${csvDone.trim()}`);

  await page.getByTestId("sl-mode-manuscript").click();
  await page
    .getByTestId("sl-manuscript-text")
    .fill(
      [
        "# Chapter nine",
        "",
        "The strait was quiet at last.",
        "",
        "***",
        "",
        "Mira closed the ledger.",
      ].join("\n"),
    );
  await page.getByTestId("sl-split-preview").click();
  await page.getByTestId("sl-split-summary").waitFor();
  const splitSummary = await page.getByTestId("sl-split-summary").textContent();
  if (!splitSummary?.includes("2 scenes")) {
    throw new Error(`split preview said ${JSON.stringify(splitSummary)}, expected 2 scenes`);
  }
  await axeScan("export-import");
  await page.getByTestId("sl-split-import").click();
  await page.getByTestId("sl-split-done").waitFor({ timeout: 20000 });
  console.log(
    `  manuscript split: ${(await page.getByTestId("sl-split-done").textContent())?.trim()}`,
  );

  // The two CSV imports and the split added rows; the round trip below needs a project whose
  // counts match between the JSON export and the imported copy, so re-export JSON now. Back to
  // the export tab first — the importer panes replaced it.
  await page.getByTestId("sl-mode-export").click();
  await page.getByTestId("sl-export-panel").waitFor({ timeout: 15000 });
  let jsonFinal = await runExport("json");
  let jsonFinalDocument = JSON.parse(jsonFinal.bytes.toString("utf8"));
  console.log(
    `  json (final): ${jsonFinalDocument.scenes.length} scenes · ${jsonFinalDocument.characters.length} characters`,
  );
  await page.screenshot({ path: join(shotDir, "22-export.png"), fullPage: true });

  // 4x. Slice 13: writing mode. The dashboard resumes where the writer stopped, the editor counts
  // words live and saves them, focus mode hides every other control, and the prose survives a
  // reload — the web half of the "kill the app mid-scene, lose nothing" promise.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-continue-card").waitFor({ timeout: 20000 });
  await page.getByTestId("sl-continue-write").click();
  await page.getByTestId("sl-write").waitFor({ timeout: 20000 });
  await axeScan("write");

  // Immersive: writing mode owns the screen — no app bar, no tab bar.
  if ((await page.locator(".sl-appbar").count()) !== 0) {
    throw new Error("writing mode still shows the app bar");
  }
  if ((await page.locator(".sl-tabbar").count()) !== 0) {
    throw new Error("writing mode still shows the tab bar");
  }

  // The draft seeds from two queries; the mounted editor is the marker that it landed. The
  // scene id comes from the route (a scene may legitimately have no title).
  await page.locator(".sl-write .ProseMirror").waitFor({ timeout: 20000 });
  const writeSceneId = await page.evaluate(() => window.location.hash.split("/").pop() ?? "");
  const writeSceneTitle = await page.getByTestId("sl-write-title").inputValue();
  const wordsText = (await page.getByTestId("sl-write-words").textContent()) ?? "";
  const wordsBefore = Number.parseInt(wordsText.match(/\d+/)?.[0] ?? "0", 10);
  console.log(`  writing mode: opened ${JSON.stringify(writeSceneTitle)} at ${wordsBefore} words`);

  const writtenText =
    "The harbour bells rang twice before the fog lifted and the cartographers set out.";
  const writtenWords = 14;
  await page.locator(".ProseMirror").click();
  await page.keyboard.type(writtenText);
  await page.waitForFunction(
    (expected) =>
      (document.querySelector('[data-testid="sl-write-words"]')?.textContent ?? "").startsWith(
        String(expected),
      ),
    wordsBefore + writtenWords,
    { timeout: 15000 },
  );
  await page.getByTestId("sl-write-saved").filter({ hasText: "Saved" }).waitFor({ timeout: 15000 });
  console.log(`  writing mode: live count ${wordsBefore + writtenWords} words, saved`);

  // Scene switcher: the whole book, current scene marked, and coming back restores the prose.
  await page.getByTestId("sl-write-switch").click();
  await page.getByTestId("sl-switcher").waitFor({ timeout: 15000 });
  const switcherRows = page.locator(".sl-write-switcher-row");
  const switcherCount = await switcherRows.count();
  if (switcherCount < 40) {
    throw new Error(`scene switcher lists ${switcherCount} scenes, expected 40+`);
  }
  await page.locator('.sl-write-switcher-row:not([aria-current="true"])').first().click();
  await page.waitForFunction(
    (previous) =>
      (document.querySelector('[data-testid="sl-write-title"]')?.value ?? "") !== previous,
    writeSceneTitle,
    { timeout: 15000 },
  );
  await page.getByTestId("sl-write-switch").click();
  await page.locator(`.sl-write-switcher-row[data-scene-id="${writeSceneId}"]`).first().click();
  await page.waitForFunction(
    (needle) =>
      (document.querySelector(".sl-write .ProseMirror")?.textContent ?? "").includes(needle),
    writtenText.slice(0, 30),
    { timeout: 15000 },
  );
  console.log(`  writing mode: switcher listed ${switcherCount} scenes, prose came back`);

  // Typography: size steps and the serif face are device preferences, applied to the page.
  await page.getByTestId("sl-write-type").click();
  await page.getByTestId("sl-write-type-sheet").waitFor({ timeout: 10000 });
  const sizeBefore = (await page.getByTestId("sl-write-size").textContent()) ?? "";
  await page.getByRole("button", { name: "Larger" }).click();
  const sizeAfter = (await page.getByTestId("sl-write-size").textContent()) ?? "";
  if (sizeBefore === sizeAfter) throw new Error("type size did not change");
  await page.getByRole("checkbox").check();
  if ((await page.locator(".sl-write-serif").count()) !== 1) {
    throw new Error("serif toggle did not reach the page");
  }
  console.log(`  writing mode: type ${sizeBefore} → ${sizeAfter} px, serif on`);

  // Focus mode: only the prose and the count stay.
  await page.getByTestId("sl-write-focus").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sl-write"]')?.getAttribute("data-focus") === "1",
    undefined,
    { timeout: 10000 },
  );
  if ((await page.getByTestId("sl-write-switch").count()) !== 0) {
    throw new Error("focus mode still shows the scene switcher button");
  }
  await axeScan("write-focus");
  await page.getByTestId("sl-write-focus").click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sl-write"]')?.getAttribute("data-focus") === "0",
    undefined,
    { timeout: 10000 },
  );
  console.log("  writing mode: focus mode hides the chrome and comes back");

  // Reload: reopen the library and let the dashboard card resume the scene — the prose is there.
  await page.getByTestId("sl-write-back").click();
  await page.getByRole("link", { name: "Scenes" }).waitFor({ timeout: 15000 });
  await page.reload();
  await page.getByText("Your libraries").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-continue-card").waitFor({ timeout: 20000 });
  const continueText = (await page.getByTestId("sl-continue-card").textContent()) ?? "";
  if (!continueText.includes("Pick up where you left off")) {
    throw new Error(
      `continue card does not resume the written scene: ${JSON.stringify(continueText)}`,
    );
  }
  await page.getByTestId("sl-continue-write").click();
  await page.getByTestId("sl-write").waitFor({ timeout: 20000 });
  await page.waitForFunction(
    (needle) =>
      (document.querySelector(".sl-write .ProseMirror")?.textContent ?? "").includes(needle),
    writtenText.slice(0, 30),
    { timeout: 15000 },
  );
  await page.screenshot({ path: join(shotDir, "23-write.png"), fullPage: true });
  console.log("  writing mode: prose survived the reload via the resume card");
  await page.getByTestId("sl-write-back").click();
  await page.getByRole("link", { name: "Scenes" }).waitFor({ timeout: 15000 });

  // 4y. Slice 14: the notes incubator. Capture a thought with one keystroke, sort it into the
  // incubator from the row menu, give it a body, promote it to a scene — then backdate a second
  // note and prove the dashboard's "Revisit these ideas" nudge fires without any network.
  await page.getByRole("link", { name: "Notes" }).click();
  await page.getByTestId("sl-capture-input").waitFor({ timeout: 15000 });
  await page.getByTestId("sl-capture-input").fill("A knife in the dark");
  await page.getByTestId("sl-capture-input").press("Enter");
  await page.waitForTimeout(800);
  const capturedNotes = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    return session.driver.query(
      "SELECT id, title, status, kind FROM idea_note WHERE deleted_at IS NULL ORDER BY created_at",
    );
  });
  const note = capturedNotes.find((row) => row.title === "A knife in the dark");
  if (!note) throw new Error(`quick capture never landed: ${JSON.stringify(capturedNotes)}`);
  if (note.status !== "inbox") throw new Error(`quick capture landed in "${note.status}"`);
  console.log("  notes: quick capture landed in the inbox");
  await axeScan("notes");

  await page.getByTestId(`sl-note-move-${note.id}`).click();
  await page.getByTestId(`sl-note-move-${note.id}-incubating`).click();
  await page.waitForTimeout(600);
  const movedStatus = await page.evaluate(async (id) => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT status FROM idea_note WHERE id = ?", [id]);
    return rows[0]?.status ?? null;
  }, note.id);
  if (movedStatus !== "incubating") throw new Error(`the note did not move: ${movedStatus}`);

  await page.getByTestId(`sl-note-${note.id}`).click();
  await page.getByTestId("sl-note-title").waitFor({ timeout: 15000 });
  await page.locator(".sl-note-sheet .ProseMirror").click();
  await page.keyboard.type("Mina should be the one holding it.");
  await page.waitForTimeout(1200);
  const noteBody = await page.evaluate(async (id) => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT body_text FROM idea_note WHERE id = ?", [id]);
    return rows[0]?.body_text ?? "";
  }, note.id);
  if (!noteBody.includes("Mina should be the one")) {
    throw new Error(`the note body did not save: ${JSON.stringify(noteBody)}`);
  }
  await axeScan("note-sheet");

  await page.getByTestId("sl-note-promote-scene").click();
  await page.waitForTimeout(1000);
  const promotion = await page.evaluate(async (id) => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT status, promoted_to_type, promoted_to_id FROM idea_note WHERE id = ?",
      [id],
    );
    return rows[0];
  }, note.id);
  if (promotion.status !== "used" || promotion.promoted_to_type !== "scene") {
    throw new Error(`promotion did not stick: ${JSON.stringify(promotion)}`);
  }
  const promotedScene = await page.evaluate(async (id) => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT title, synopsis_text FROM scene WHERE id = ?", [
      id,
    ]);
    return rows[0];
  }, promotion.promoted_to_id);
  if (!promotedScene || promotedScene.title !== "A knife in the dark") {
    throw new Error(`the promoted scene is wrong: ${JSON.stringify(promotedScene)}`);
  }
  if (promotedScene.synopsis_text?.includes("Mina should be the one") !== true) {
    throw new Error("the promoted scene did not inherit the note body");
  }
  await page.getByTestId("sl-note-promoted").waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(shotDir, "24-notes.png"), fullPage: true });
  console.log(`  notes: promoted to scene "${promotedScene.title}" with the body as its synopsis`);
  await page.keyboard.press("Escape");

  // A second note, incubated and backdated 40 days, must raise the dashboard nudge after reload.
  await page.getByTestId("sl-capture-input").fill("Old idea about the tide");
  await page.getByTestId("sl-capture-input").press("Enter");
  await page.waitForTimeout(800);
  const backdated = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT id FROM idea_note WHERE title = 'Old idea about the tide'",
    );
    const id = rows[0]?.id;
    if (!id) return null;
    await session.driver.query(
      "UPDATE idea_note SET status = 'incubating', updated_at = ? WHERE id = ?",
      [Date.now() - 40 * 24 * 60 * 60 * 1000, id],
    );
    return id;
  });
  if (backdated === null) throw new Error("the second note never landed");
  await page.reload();
  await page.getByText("Your libraries").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-revisit-card").waitFor({ timeout: 15000 });
  console.log("  notes: the revisit card fires on a 40-day-old incubating note");
  await axeScan("dashboard-revisit");

  // 4z. Slice 14: attachments. Add a real PNG to a character's gallery, check the blob landed in
  // the library, then export the folder format and prove the picture rides it as a real file.
  const pngPath = join(exportDir, "harbour.png");
  writeFileSync(
    pngPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  await page.getByRole("link", { name: "People" }).click();
  await page.getByRole("link", { name: /Mira Holt/ }).click();
  await page.getByTestId("sl-gallery-input").setInputFiles(pngPath);
  await page.waitForTimeout(2000);
  const attachment = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      `SELECT a.id, a.file_name, a.byte_size, a.sha256, LENGTH(b.data) AS blob_size
         FROM attachment a JOIN attachment_blob b ON b.attachment_id = a.id`,
    );
    return rows[0];
  });
  if (!attachment) throw new Error("the attachment never reached the library");
  if (attachment.blob_size !== attachment.byte_size) {
    throw new Error(`blob size ${attachment.blob_size} ≠ metadata ${attachment.byte_size}`);
  }
  await page.getByTestId(`sl-attachment-${attachment.id}`).waitFor({ timeout: 15000 });
  await axeScan("gallery");
  console.log(
    `  attachments: ${attachment.file_name} stored (${attachment.byte_size} bytes, sha ${attachment.sha256.slice(0, 8)}…)`,
  );

  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByTestId("sl-open-export").click();
  await page.getByTestId("sl-export-panel").waitFor({ timeout: 20000 });
  const folderWithAttachments = await runExport("markdown-folder");
  const attachmentFiles = Object.keys(
    unzipSync(new Uint8Array(folderWithAttachments.bytes)),
  ).filter((path) => path.includes("attachments/"));
  const expected = `${attachment.sha256}.png`;
  if (!attachmentFiles.some((path) => path.endsWith(expected))) {
    throw new Error(
      `the folder export has no attachments/${expected}: ${attachmentFiles.join(", ") || "(none)"}`,
    );
  }
  console.log(`  attachments: folder export carries attachments/${expected}`);

  // The promoted scene is newer than the JSON export step 7 imports: re-export it now so the
  // import check compares against the library as it stands (44 scenes, not 43).
  jsonFinal = await runExport("json");
  jsonFinalDocument = JSON.parse(jsonFinal.bytes.toString("utf8"));
  await page.screenshot({ path: join(shotDir, "25-gallery.png"), fullPage: true });

  // 5. Reload: back to the start screen; reopening restores the last route (hash history),
  // so tab over to Plan and check the persisted progress.
  await page.reload();
  await page.getByText("Your libraries").waitFor();
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByText("8 of 9 steps complete").waitFor();

  // 6. Close → listed → reopen → still 7 of 9 (persistence across driver instances).
  await page.getByRole("button", { name: "Close library" }).click();
  await page.getByText("Your libraries").waitFor();
  await page.getByText("Slice Demo").waitFor();
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByText("8 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "5-reopened.png"), fullPage: true });

  // 7. Slice 12: the other half of the round trip — import the JSON exported in step 4w as a
  // brand-new library and prove the chapters, scenes and characters arrived. Runs with the first
  // library closed (the pool's access handles belong to the page that opened it).
  await page.getByRole("button", { name: "Close library" }).click();
  await page.getByText("Your libraries").waitFor();
  // Opening a second library in the same page can lose a race for the pool's access handles
  // (the previous session's worker releases them asynchronously). Retry with a reload: the
  // importer creates a fresh library name on the second try, which is deliberate and harmless.
  let imported = false;
  for (let attempt = 0; attempt < 3 && !imported; attempt += 1) {
    if (attempt > 0) {
      await page.reload();
      await page.getByText("Your libraries").waitFor({ timeout: 30000 });
    }
    await page.getByTestId("sl-import-input").setInputFiles(jsonFinal.path);
    try {
      await page.getByRole("link", { name: "Plan" }).waitFor({ timeout: 25000 });
      imported = true;
    } catch {
      const text = await page.innerText("body").catch(() => "<no body>");
      console.log(`  import attempt ${attempt + 1} stayed on the start screen:
${text.slice(0, 400)}`);
    }
  }
  if (!imported) throw new Error("the exported JSON never opened as a new library");
  const importedTitle = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query("SELECT title FROM project");
    return rows.map((row) => row.title);
  });
  if (!importedTitle.includes("The Cartographer's Sea")) {
    throw new Error(`imported library holds projects ${JSON.stringify(importedTitle)}`);
  }
  await page.getByRole("link", { name: "Scenes" }).click();
  await page.waitForTimeout(2500);
  const importedScenes = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT COUNT(*) AS n FROM scene WHERE deleted_at IS NULL",
    );
    return rows[0].n;
  });
  if (importedScenes !== jsonFinalDocument.scenes.length) {
    throw new Error(
      `imported ${importedScenes} scenes, the export carried ${jsonFinalDocument.scenes.length}`,
    );
  }
  await page.getByRole("link", { name: "People" }).click();
  await page.waitForTimeout(2000);
  const peopleText = await page.innerText("body");
  if (!peopleText.includes("Mira Holt"))
    throw new Error("the imported characters are not on the People screen");
  const importedCharacters = await page.evaluate(async () => {
    const session = window.__starlineDev.session();
    const rows = await session.driver.query(
      "SELECT COUNT(*) AS n FROM character WHERE deleted_at IS NULL",
    );
    return rows[0].n;
  });
  console.log(`  imported library: ${importedScenes} scenes · ${importedCharacters} characters`);
  await page.screenshot({ path: join(shotDir, "23-imported.png"), fullPage: true });

  console.log("WEB-VERIFY OK");
  console.log(`screenshots: ${shotDir}`);
} catch (cause) {
  if (page !== null) {
    await page.screenshot({ path: join(shotDir, "failure.png"), fullPage: true }).catch(() => {});
    const text = await page.innerText("body").catch(() => "<no body text>");
    console.log("--- FAILURE CONTEXT (page text) ---");
    console.log(text.slice(0, 1500));
  }
  throw cause;
} finally {
  await browser.close();
  server?.kill();
}
