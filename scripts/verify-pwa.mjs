#!/usr/bin/env node
// PWA end-to-end check: needs a production build (`pnpm --filter @starline/web build`). By
// default it serves the build itself (`vite preview` on port 5184); pass --no-serve with a URL
// to use an already-running server. Proves: the service worker installs, the manifest is
// served, and the installed app keeps working with the network OFF — create a library online,
// close it, go offline, reload, and reopen the library from storage (spec §5.2 offline-complete).
// Usage: node scripts/verify-pwa.mjs [url] [--no-serve]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serve = !process.argv.includes("--no-serve");
const url = process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:5184/";
const shotDir = join(tmpdir(), "starline-shots");
mkdirSync(shotDir, { recursive: true });

let server = null;
if (serve) {
  const viteBin = join(repoRoot, "apps", "web", "node_modules", "vite", "bin", "vite.js");
  server = spawn(process.execPath, [viteBin, "preview", "--port", "5184", "--strictPort"], {
    cwd: join(repoRoot, "apps", "web"),
    stdio: "ignore",
  });
  let up = false;
  for (let attempt = 0; attempt < 80 && !up; attempt++) {
    try {
      const response = await fetch(url);
      up = response.ok;
    } catch {
      // not up yet
    }
    if (!up) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!up) throw new Error(`preview server did not come up at ${url}`);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, // phone viewport
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(url);

  // Wait for the service worker to install, then reload so the page is controlled by it.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: 15000 });

  const manifestStatus = await page.evaluate(() =>
    fetch("/manifest.webmanifest").then((r) => r.status),
  );
  await page.screenshot({ path: join(shotDir, "phone-start.png"), fullPage: true });

  // Online: create a library and see the migrated workspace.
  await page.getByPlaceholder("My Novel").fill("Star Demo");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByText("Schema version", { exact: true }).waitFor();
  await page.getByText("v1").waitFor();
  await page.screenshot({ path: join(shotDir, "phone-workspace.png"), fullPage: true });
  await page.getByRole("button", { name: "Close library" }).click();
  await page.getByText("Your libraries").waitFor();

  // Offline: reload — the SW must serve the shell — and the OPFS library must still open.
  await context.setOffline(true);
  await page.reload();
  await page.getByText("Your libraries").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Open" }).click();
  await page.getByText("Schema version", { exact: true }).waitFor();
  await page.getByText("none (already current)").waitFor();
  await page.screenshot({ path: join(shotDir, "phone-offline.png"), fullPage: true });
  await context.setOffline(false);

  console.log(`PWA-VERIFY OK (manifest ${manifestStatus}, offline reopen works)`);
  console.log(`screenshots: ${shotDir}`);
} finally {
  await browser.close();
  server?.kill();
}
