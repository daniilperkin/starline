#!/usr/bin/env node
// Headless E2E check for the M0 web shell (spec §5.7 exit criterion): create a library,
// see the migrated workspace, close it, and find it listed again. Run against a live dev
// server: `node scripts/verify-web.mjs [url]`.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:5183/";
const shotDir = join(tmpdir(), "starline-shots");
mkdirSync(shotDir, { recursive: true });

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
}
