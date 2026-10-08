#!/usr/bin/env node
// Pins the star-library contrast rules from docs/DESIGN.md (the CatBookTracker
// "accent is decoration, never text" rule applied to the star palette):
//   - body-text pairs must clear WCAG AA (>= 4.5)
//   - the dark-sky gold is the action colour, so it must clear AA on the canvas
//   - the day-sky gold must NOT clear AA: if this ever passes, someone promoted the
//     gold to a text colour and docs/DESIGN.md has to be updated first
//   - wordmark gradient stops are large text (>= 3.0)
// Run: node scripts/check-contrast.mjs  (exit 1 on any violated rule)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const stylesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "web",
  "src",
  "styles.css",
);
const css = readFileSync(stylesPath, "utf8");

function themeVars(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`theme block not found in styles.css: ${selector}`);
  const block = css.slice(start, css.indexOf("}", start));
  const vars = {};
  for (const match of block.matchAll(/--sl-([\w-]+):\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return vars;
}

function toRgb(value) {
  const hex = value.startsWith("#") ? value.slice(1) : value;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`expected a 6-digit hex colour, got: ${value}`);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(toRgb(fg)), luminance(toRgb(bg))].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const light = themeVars(":root {");
const dark = themeVars('[data-theme="dark"] {');

// [theme, label, fg, bg, operator, threshold]
const rules = [
  // Dark night sky: text, muted, gold-as-action, starlight wordmark stop.
  ["dark", "text on canvas", dark.text, dark.bg, ">=", 4.5],
  ["dark", "muted on canvas", dark.muted, dark.bg, ">=", 4.5],
  ["dark", "on-primary on primary (gold button)", dark["on-primary"], dark.primary, ">=", 4.5],
  ["dark", "accent on canvas (carries text here)", dark.accent, dark.bg, ">=", 4.5],
  ["dark", "wordmark-b (starlight) on canvas", dark["wordmark-b"], dark.bg, ">=", 4.5],
  // Light day sky: text, muted, violet action, large-text wordmark, gold decoration pin.
  ["light", "text on canvas", light.text, light.bg, ">=", 4.5],
  ["light", "muted on canvas", light.muted, light.bg, ">=", 4.5],
  ["light", "white on primary (violet button)", "#ffffff", light.primary, ">=", 4.5],
  ["light", "wordmark-a on canvas (large text)", light["wordmark-a"], light.bg, ">=", 3.0],
  ["light", "wordmark-b on canvas (large text)", light["wordmark-b"], light.bg, ">=", 3.0],
  ["light", "accent on canvas (decoration-only pin)", light.accent, light.bg, "<", 4.5],
];

let failed = 0;
for (const [theme, label, fg, bg, operator, threshold] of rules) {
  const ratio = contrast(fg, bg);
  const ok = operator === ">=" ? ratio >= threshold : ratio < threshold;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${theme.padEnd(5)} ${label.padEnd(40)} ${ratio.toFixed(2)} (${operator} ${threshold})`);
}

if (failed > 0) {
  console.error(`CONTRAST FAIL — ${failed} rule(s) violated; see docs/DESIGN.md before changing tokens.`);
  process.exit(1);
}
console.log("CONTRAST OK — star-library palette matches its design contract.");
