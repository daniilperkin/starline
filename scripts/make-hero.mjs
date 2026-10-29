import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

// Composes docs/screenshots/hero.png — the three phone shots side by side on the app's own
// background — straight from docs/screenshots/{start,plan,scenes}.png. Playwright does the
// compositing, so the repo needs no image library.
//   node scripts/make-hero.mjs
const OUT = join(process.cwd(), "docs", "screenshots");
const SHOTS = ["start.png", "plan.png", "scenes.png"];

const PHONE_H = 640;
const PHONE_W = Math.round((PHONE_H * 390) / 844); // 296
const GAP = 46;
const MARGIN = 56;
const WIDTH = PHONE_W * 3 + GAP * 2 + MARGIN * 2;
const HEIGHT = PHONE_H + MARGIN * 2;
// GitHub renders a README image at ~860 CSS px; 1.5x is crisp on 2x screens at half the
// file size of a 2x capture.
const SCALE = 1.5;

const img = (name) => {
  const bytes = readFileSync(join(OUT, name)).toString("base64");
  return `data:image/png;base64,${bytes}`;
};

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { background: #13132a; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
      .row { display: flex; gap: ${GAP}px; padding: ${MARGIN}px; align-items: center; }
      img {
        width: ${PHONE_W}px;
        height: ${PHONE_H}px;
        border-radius: 34px;
        border: 2px solid #342c52;
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
        display: block;
      }
    </style>
  </head>
  <body>
    <div class="row">${SHOTS.map((n) => `<img src="${img(n)}" alt="${n}" />`).join("")}</div>
  </body>
</html>`;

const tmp = join(OUT, ".hero.tmp.html");
writeFileSync(tmp, html, "utf8");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: SCALE,
});
const page = await ctx.newPage();
await page.goto(pathToFileURL(tmp).href, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, "hero.png") });
await browser.close();

console.log(
  `hero.png -> ${Math.round(WIDTH * SCALE)}x${Math.round(HEIGHT * SCALE)} (from ${SHOTS.join(", ")})`,
);
