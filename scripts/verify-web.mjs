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
// everything persisted.
// By default the script serves the dev build itself (vite dev, port 5183); pass --no-serve
// with a URL to use an already-running server.
// Usage: node scripts/verify-web.mjs [url] [--no-serve]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serve = !process.argv.includes("--no-serve");
const url = process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:5183/";
const shotDir = join(tmpdir(), "starline-shots");
mkdirSync(shotDir, { recursive: true });

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

  // 4i. Re-import the same list: merge by line — zero created, 40 updated, no duplicates.
  await page.getByRole("textbox", { name: "Paste a scene list" }).fill(pasteText);
  await page.getByRole("button", { name: "Create scenes from list" }).click();
  await page.getByText(/40 updated/).waitFor();
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
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("8 of 9 steps complete").waitFor();

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
