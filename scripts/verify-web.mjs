#!/usr/bin/env node
// Headless E2E for the web shell (spec §5.7 exit criterion + Slice 1): create a library,
// create a story, write and complete Snowflake steps 1–2, then reload/close/reopen and prove
// the plan persisted. By default the script serves the dev build itself (vite dev, port
// 5183); pass --no-serve with a URL to use an already-running server.
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
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  await page.goto(url);

  // Warm-up: on a cold dev server vite pre-bundles dependencies and reloads the page when the
  // bundle set changes (new UI deps). Let that settle before driving the UI.
  await page.getByPlaceholder("My Novel").waitFor();
  await page.waitForTimeout(2500);
  await page.reload();
  await page.getByPlaceholder("My Novel").waitFor();

  // 1. Create a library.
  await page.getByPlaceholder("My Novel").fill("Slice Demo");
  await page.screenshot({ path: join(shotDir, "1-start.png"), fullPage: true });
  await page.getByRole("button", { name: "Create" }).click();

  // 2. Plan tab: create the story (first-run migrations + wasm init can take a moment).
  await page.getByPlaceholder("Name your story").waitFor({ timeout: 60_000 });
  await page.getByPlaceholder("Name your story").fill("The Cartographer's Sea");
  await page.getByRole("button", { name: "Create story" }).click();
  await page.getByText("0 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "2-plan.png"), fullPage: true });

  // 3. Step 1: write the sentence (autosave), then complete it.
  await page.getByRole("button", { name: /One sentence/ }).click();
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
  await page.getByRole("button", { name: /One paragraph/ }).click();
  await page.getByLabel("Setup").fill("A quiet harbour town thrives on the trade winds.");
  await page.getByLabel("Disaster 1").fill("The winds vanish and the fleet is stranded.");
  await page.getByLabel("Disaster 2").fill("A rival fleet arrives to claim the harbour.");
  await page.getByLabel("Disaster 3").fill("The harbour burns and the townsfolk scatter.");
  await page.getByLabel("Ending").fill("The harbour is rebuilt from the ruins of the fleet.");
  await page.getByRole("button", { name: "Mark step complete" }).click();
  await page.getByText("2 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "4-step2-done.png"), fullPage: true });

  // 5. Reload: back to the start screen; reopening the library shows the persisted plan.
  await page.reload();
  await page.getByText("Your libraries").waitFor();
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByText("2 of 9 steps complete").waitFor();

  // 6. Close → listed → reopen → still 2 of 9 (persistence across driver instances).
  await page.getByRole("button", { name: "Close library" }).click();
  await page.getByText("Your libraries").waitFor();
  await page.getByText("Slice Demo").waitFor();
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByText("2 of 9 steps complete").waitFor();
  await page.screenshot({ path: join(shotDir, "5-reopened.png"), fullPage: true });

  console.log("WEB-VERIFY OK");
  console.log(`screenshots: ${shotDir}`);
} finally {
  await browser.close();
  server?.kill();
}
