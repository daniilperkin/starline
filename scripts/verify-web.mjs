#!/usr/bin/env node
// Headless E2E check for the web shell (spec §5.7 exit criterion): create a library, see the
// migrated workspace, close it, and find it listed again. By default the script serves the dev
// build itself (vite dev, port 5183); pass --no-serve with a URL to use an already-running
// server. Usage: node scripts/verify-web.mjs [url] [--no-serve]
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(url);

  await page.getByPlaceholder("My Novel").fill("M0 Demo");
  await page.screenshot({ path: join(shotDir, "1-start.png"), fullPage: true });
  await page.getByRole("button", { name: "Create" }).click();

  // Workspace: migration 0001 applied, schema stamped, revision visible.
  await page.getByText("Schema version", { exact: true }).waitFor();
  await page.getByText("v1").waitFor();
  await page.getByText("Migrations applied on open").waitFor();
  await page.screenshot({ path: join(shotDir, "2-workspace.png"), fullPage: true });

  // Close returns to the start screen and the library is listed.
  await page.getByRole("button", { name: "Close library" }).click();
  await page.getByText("Your libraries").waitFor();
  await page.getByText("M0 Demo").waitFor();
  await page.screenshot({ path: join(shotDir, "3-reopen.png"), fullPage: true });

  // Re-open the listed library to prove persistence across driver instances.
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByText("Schema version", { exact: true }).waitFor();
  await page.getByText("none (already current)").waitFor();

  console.log("WEB-VERIFY OK");
  console.log(`screenshots: ${shotDir}`);
} finally {
  await browser.close();
  server?.kill();
}
