import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:4175";
const OUT = join(process.cwd(), "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "en-US",
  colorScheme: "dark",
});
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));

await page.goto(BASE, { waitUntil: "load" });
await page.getByPlaceholder("My Novel").waitFor({ timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(2500); // starfield + first paint settle

// 1. Start screen (empty input shows the placeholder).
await page.screenshot({ path: join(OUT, "start.png") });
console.log("start.png");

// 2. Create the demo library and walk the first-run wizard (keeps every module on).
await page.getByPlaceholder("My Novel").fill("Starlight Library");
await page.getByRole("button", { name: "Create" }).click();
await page.getByTestId("sl-onboarding").waitFor({ timeout: 20_000 });
for (let i = 0; i < 4; i += 1) {
  await page.getByTestId("sl-onboarding-next").click();
}
await page.getByTestId("sl-onboarding").waitFor({ state: "hidden", timeout: 8_000 });

// 3. Create the story.
await page.getByPlaceholder("Name your story").waitFor({ timeout: 60_000 });
await page.getByPlaceholder("Name your story").fill("The Ferry at Dusk");
await page.getByRole("button", { name: "Create story" }).click();
await page.getByText("0 of 9 steps complete").waitFor({ timeout: 20_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, "plan.png") });
console.log("plan.png");

// 4. Step 8 -> apply the three-act structure template so the outliner has real scenes.
await page.locator(".sl-step-row").filter({ hasText: "Scene list" }).click();
await page.waitForTimeout(1500);
await page.locator('[data-testid="sl-templates-open"]').click();
await page.locator('[data-testid="sl-template-three-act"]').click();
await page.waitForTimeout(600);
await page.locator('[data-testid="sl-template-apply"]').click();
await page.locator('[data-testid="sl-template-report"]').waitFor({ timeout: 20_000 });
await page.waitForTimeout(800);

// 5. Scenes tab (hash navigation: the template's role="status" notice overlaps the tab bar).
await page.evaluate(() => {
  window.location.hash = "#/scenes";
});
await page.waitForTimeout(1600);
await page.screenshot({ path: join(OUT, "scenes.png") });
console.log("scenes.png");

await browser.close();
console.log("SHOTS OK ->", OUT);
