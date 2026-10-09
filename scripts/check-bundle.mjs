#!/usr/bin/env node
// Bundle budget gate (spec §5.1: budgets become CI gates; fail when exceeded by > 5 %).
// Checks the sizes of the last production build in apps/web/dist. Run a build first
// (`pnpm build:web` / the Capacitor build) — a missing dist fails loudly.
// Usage: node scripts/check-bundle.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repoRoot, "apps", "web", "dist");
const assets = join(dist, "assets");

/**
 * Budgets in KiB of gzip — the phone-first payload that actually crosses the wire on install.
 * Measured 2026-10-09 (slice 5): app 307, css 4, worker 63; slice 6 adds the lore wiki +
 * mention picker → app 328. The gate fails only beyond the spec §5.1 tolerance (budget + 5 %)
 * and prints TIGHT inside the band, so routine dependency patches don't flap it while a real
 * regression still fails loudly. Raise deliberately, never silently.
 */
const TOLERANCE = 1.05;
const BUDGETS = [
  { match: /^index-.*\.js$/, label: "app bundle (gzip)", limitKib: 330 },
  { match: /^index-.*\.css$/, label: "styles (gzip)", limitKib: 8 },
  { match: /^worker-.*\.js$/, label: "storage worker (gzip)", limitKib: 72 },
];

let files;
try {
  files = readdirSync(assets);
} catch {
  throw new Error(`no build found at ${assets} — run a production build first`);
}

let failed = false;
let tight = 0;
for (const budget of BUDGETS) {
  const name = files.find((file) => budget.match.test(file));
  if (!name) {
    console.log(`MISS  ${budget.label}: no file matches ${budget.match}`);
    failed = true;
    continue;
  }
  const raw = readFileSync(join(assets, name));
  const gzipKib = gzipSync(raw, { level: 9 }).byteLength / 1024;
  const over = gzipKib > budget.limitKib * TOLERANCE;
  const inBand = !over && gzipKib > budget.limitKib;
  if (over) failed = true;
  if (inBand) tight += 1;
  console.log(
    `${over ? "OVER " : inBand ? "TIGHT" : "OK   "} ${budget.label}: ${gzipKib.toFixed(1)} KiB / ${budget.limitKib} KiB (${name})`,
  );
}

// The whole installed payload (wasm included) stays within the offline app's install budget.
function dirSize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? dirSize(child) : statSync(child).size;
  }
  return total;
}
const totalMib = dirSize(dist) / (1024 * 1024);
const totalOk = totalMib <= 4 * TOLERANCE;
if (!totalOk) failed = true;
console.log(
  `${totalOk ? (totalMib > 4 ? "TIGHT" : "OK   ") : "OVER "} install payload: ${totalMib.toFixed(2)} MiB / 4 MiB`,
);

if (failed) {
  console.error("BUNDLE-BUDGET FAILED");
  process.exit(1);
}
console.log(
  tight > 0
    ? `BUNDLE-BUDGET OK (${tight} budget(s) inside the 5 % band — plan a code-split before the next slice)`
    : "BUNDLE-BUDGET OK",
);
