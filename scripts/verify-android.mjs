#!/usr/bin/env node
// Scripted emulator flow for the Android APK (docs/PLAN.md §6 gate). Expects a booted
// emulator or attached device, installs the APK fresh, then drives the Capacitor WebView
// over CDP (Playwright connectOverCDP): create library → create story → complete steps 1–4
// (character card, step-4 seed trigger, rich-text editors) → step-8 paste import on-device →
// Scenes tab + scene-sheet round-trip → hardware back navigation → minimise at the root →
// cold relaunch keeps the plan.
// Usage: node scripts/verify-android.mjs [apk-path]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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
try {
  adb(["uninstall", PACKAGE]); // a fresh install keeps the run deterministic
} catch {
  // not installed — fine
}
adb(["install", "-r", apk]);
adb(["shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`]);
await sleep(3000);

let { browser, page } = await connect();
try {
  // 1. Create the library, then the story.
  await page.getByPlaceholder("My Novel").waitFor({ timeout: 30000 });
  await page.getByPlaceholder("My Novel").fill("Emu Demo");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByPlaceholder("Name your story").waitFor({ timeout: 90000 });
  await page.getByPlaceholder("Name your story").fill("Emulator Story");
  await page.getByRole("button", { name: "Create story" }).click();
  await page.getByText("0 of 9 steps complete").waitFor({ timeout: 30000 });
  console.log("PASS  library + story created");

  // 2. Step 1: write the sentence and complete it.
  await page.getByRole("button", { name: /One sentence/ }).click();
  await page
    .getByLabel("One sentence")
    .fill(
      "A grieving cartographer must map a shifting island before it sinks and takes her sister with it",
    );
  await page.getByText("17 / 25 words").waitFor();
  await completeStepAndWait(page, "1 of 9 steps complete");
  console.log("PASS  step 1 completed");

  // 2b. Step 2: the five sentences.
  await page.getByRole("button", { name: /One paragraph/ }).click();
  await page.getByLabel("Setup").fill("A quiet harbour town thrives on the trade winds.");
  await page.getByLabel("Disaster 1").fill("The winds vanish and the fleet is stranded.");
  await page.getByLabel("Disaster 2").fill("A rival fleet arrives to claim the harbour.");
  await page.getByLabel("Disaster 3").fill("The harbour burns and the townsfolk scatter.");
  await page.getByLabel("Ending").fill("The harbour is rebuilt from the ruins of the fleet.");
  await completeStepAndWait(page, "2 of 9 steps complete");
  console.log("PASS  step 2 completed");

  // 2c. Step 3: a character card is created and flagged major on-device.
  await page.getByRole("button", { name: /Character summaries/ }).click();
  await page.getByPlaceholder("Character name").fill("Emu Character");
  await page.getByRole("button", { name: "Add character" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).waitFor({ timeout: 15000 });
  await page.getByLabel("Major character").check();
  await completeStepAndWait(page, "3 of 9 steps complete");
  console.log("PASS  step 3 completed with a character card");

  // 2d. Step 4: the seed trigger + the rich-text editor render and complete on-device.
  await page.getByRole("button", { name: /One-page synopsis/ }).click();
  await page.getByRole("button", { name: /Break step 2 into step 4/ }).click();
  await page.locator(".ProseMirror").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800); // let the seeded content flush before completing
  await completeStepAndWait(page, "4 of 9 steps complete");
  console.log("PASS  step 4 completed via the seed trigger");

  // 2e. Step 8 on-device: paste three scenes, create them, complete the step.
  await page.getByRole("button", { name: /Scene list/ }).click();
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
  await page.getByText(/3 scenes/).first().waitFor({ timeout: 15000 });
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

  // 3. Hardware back: from a step screen back to the plan.
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("button", { name: /Character descriptions/ }).click();
  await page.getByText("Step 5 of 9").waitFor({ timeout: 15000 });
  adb(["shell", "input", "keyevent", "4"]);
  await page.getByText("5 of 9 steps complete").waitFor({ timeout: 15000 });
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

  // 5. Cold relaunch: the library is listed and the plan survived (5 of 9).
  adb(["shell", "am", "force-stop", PACKAGE]);
  adb(["shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`]);
  await browser.close().catch(() => undefined);
  ({ browser, page } = await connect());
  await page.getByText("Your libraries").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByText("5 of 9 steps complete").waitFor({ timeout: 90000 });
  console.log("PASS  cold relaunch → library listed → plan intact (5 of 9)");

  console.log("EMULATOR-QA OK");
} finally {
  await browser.close().catch(() => undefined);
}
