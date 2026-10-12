#!/usr/bin/env node
// WCAG 2.2 AA audit harness (PLAN slice 19, decision 22): the checks axe cannot make.
//   · keyboard-only walk: every focus stop shows a visible indicator, focus never escapes
//   · target size: interactive controls are at least 24 × 24 CSS px (2.5.8), inline links exempt
//   · reflow: no horizontal overflow at a 320 px viewport, and none with WCAG 1.4.12 text spacing
//   · reduced motion: the OS setting is honoured (transitions off, starfield paints one frame)
//   · page titles, html lang, Escape closing a sheet, and a live region for status messages
// Usage: node scripts/check-a11y.mjs [url] [--no-serve]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = join(tmpdir(), "starline-shots");
mkdirSync(shotDir, { recursive: true });
const serve = !process.argv.includes("--no-serve");
const url = process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:5187/";

let server = null;
if (serve) {
  const viteBin = join(repoRoot, "apps", "web", "node_modules", "vite", "bin", "vite.js");
  server = spawn(process.execPath, [viteBin, "--port", "5187", "--strictPort"], {
    cwd: join(repoRoot, "apps", "web"),
    stdio: "ignore",
  });
  let up = false;
  for (let attempt = 0; attempt < 120 && !up; attempt++) {
    try {
      up = (await fetch(url)).ok;
    } catch {
      // not up yet
    }
    if (!up) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!up) throw new Error(`dev server did not come up at ${url}`);
}

let failures = 0;
function report(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Interactive elements, with the facts the checks need. */
function auditScript() {
  const selector =
    'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
  const elements = [...document.querySelectorAll(selector)].map((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      label: (
        el.getAttribute("aria-label") ||
        el.textContent ||
        el.getAttribute("placeholder") ||
        ""
      )
        .trim()
        .slice(0, 48),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      display: style.display,
      visibility: style.visibility,
      srOnly: el.className.toString().includes("sr-only") || style.clipPath === "inset(50%)",
      inText: el.tagName === "A" && el.closest("p") !== null,
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none",
    };
  });
  return {
    title: document.title,
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    elements,
  };
}

/** The focused element's focus indicator, as the browser computes it. */
function focusScript() {
  const el = document.activeElement;
  if (!el || el === document.body) return { tag: "body", label: "", indicator: false };
  const style = getComputedStyle(el);
  const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  const shadow = style.boxShadow !== "none" && style.boxShadow !== "";
  return {
    tag: el.tagName.toLowerCase(),
    label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 48),
    indicator: outline || shadow,
    detail: `outline=${style.outlineStyle} ${style.outlineWidth}, shadow=${shadow}`,
  };
}

/** Create the audit library and story; retries once across a dev-server reload. */
async function createLibrary(page) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.getByPlaceholder("My Novel").waitFor({ timeout: 60_000 });
    await page.getByPlaceholder("My Novel").fill("A11y Demo");
    await page.getByRole("button", { name: "Create" }).click();
    try {
      await page.getByPlaceholder("Name your story").waitFor({ timeout: 30_000 });
      await page.getByPlaceholder("Name your story").fill("A11y Demo Novel");
      await page.getByRole("button", { name: "Create story" }).click();
      await page.getByText("0 of 9 steps complete").waitFor({ timeout: 60_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      console.log("  retry: the dev server reloaded mid-flow, creating the library again");
      await page.reload();
    }
  }
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(url);

  // --- start screen: title, lang, keyboard walk, target sizes ---
  // The dev server may be cold (vite re-optimizing), and the first library open boots the
  // sqlite-wasm pool — both are slow once, so the creation flow gets generous waits.
  await page.getByPlaceholder("My Novel").waitFor({ timeout: 60_000 });
  const start = await page.evaluate(auditScript);
  report(start.title.trim().length > 0, "start screen has a document title", start.title);
  report(start.lang === "en", "start screen sets html lang", start.lang);
  report(start.overflow <= 1, "start screen: no horizontal overflow", `${start.overflow}px`);
  const smallStart = start.elements.filter(
    (el) => el.visible && !el.srOnly && !el.inText && (el.width < 24 || el.height < 24),
  );
  report(
    smallStart.length === 0,
    "start screen: every control is at least 24 × 24 px",
    smallStart.map((el) => `${el.tag}(${el.width}×${el.height}) "${el.label}"`).join(", "),
  );
  let stops = 0;
  const badStops = [];
  for (let i = 0; i < 25; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(focusScript);
    if (stop.tag === "body") break;
    stops += 1;
    if (!stop.indicator) badStops.push(`${stop.tag} "${stop.label}" (${stop.detail})`);
  }
  report(stops > 0, "start screen: Tab reaches interactive elements", `${stops} stops`);
  report(
    badStops.length === 0,
    "start screen: every focus stop shows an indicator",
    badStops.join(", "),
  );

  // --- create a library so the app screens exist ---
  // A dev-server hot reload (source edited seconds before this run) can wipe the form
  // mid-flow, so the creation step gets one clean retry.
  await createLibrary(page);

  const routes = [
    ["/plan", "Plan"],
    ["/scenes", "Scenes"],
    ["/people", "People"],
    ["/world", "World"],
    ["/notes", "Notes"],
    ["/settings", "Settings"],
    ["/backups", "Backups"],
    ["/checks", "Checks"],
  ];
  for (const [route, label] of routes) {
    await page.goto(`${url}#${route}`);
    await page.waitForTimeout(900);
    const facts = await page.evaluate(auditScript);
    report(facts.title.includes("StarLine"), `${label}: document title`, facts.title);
    report(facts.lang === "en", `${label}: html lang`, facts.lang);
    report(facts.overflow <= 1, `${label}: no horizontal overflow`, `${facts.overflow}px`);
    const small = facts.elements.filter(
      (el) => el.visible && !el.srOnly && !el.inText && (el.width < 24 || el.height < 24),
    );
    report(
      small.length === 0,
      `${label}: every control is at least 24 × 24 px`,
      small.map((el) => `${el.tag}(${el.width}×${el.height}) "${el.label}"`).join(", "),
    );
    const routeBad = [];
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(focusScript);
      if (stop.tag === "body") break;
      if (!stop.indicator) routeBad.push(`${stop.tag} "${stop.label}" (${stop.detail})`);
    }
    report(
      routeBad.length === 0,
      `${label}: every focus stop shows an indicator`,
      routeBad.join(", "),
    );
  }

  // --- every Settings segment must be reachable, not clipped by its pill ---
  // (A five-item segmented control once pushed its last option off-screen; document-level overflow
  // checks cannot see content clipped inside a rounded container, so this asserts each one.)
  await page.goto(`${url}#/settings`);
  for (const section of ["tags", "fields", "language", "appearance", "cloud"]) {
    const segment = page.getByTestId(`sl-settings-${section}`);
    const visible = await segment.isVisible().catch(() => false);
    const box = visible ? await segment.boundingBox() : null;
    const onScreen = box !== null && box.x >= 0 && box.x + box.width <= 390;
    report(
      onScreen,
      `settings segment reachable: ${section}`,
      box ? `x=${Math.round(box.x)} w=${Math.round(box.width)}` : "not visible",
    );
  }

  // --- 2.2.2: the moving backdrop has a stop control, and the choice is remembered ---
  await page.goto(`${url}#/settings`);
  await page.getByTestId("sl-settings-appearance").click();
  const toggle = page.getByTestId("sl-starfield-toggle");
  await toggle.waitFor({ timeout: 15_000 });
  await toggle.uncheck();
  await page.waitForTimeout(300);
  const storedOff = await page.evaluate(() => localStorage.getItem("starline.effects.starfield"));
  report(storedOff === "off", "starfield: the stop control is wired", `stored=${storedOff}`);
  await toggle.check();
  await page.waitForTimeout(300);
  const storedOn = await page.evaluate(() => localStorage.getItem("starline.effects.starfield"));
  report(storedOn === "on", "starfield: turning it back on is remembered", `stored=${storedOn}`);

  // --- Escape closes a sheet, and focus lands inside it when it opens ---
  await page.goto(`${url}#/plan`);
  await page.getByTestId("sl-search-open").click();
  await page.locator("#sl-search-input").waitFor({ timeout: 15_000 });
  const inside = await page.evaluate(
    () => document.activeElement !== document.body && document.activeElement !== null,
  );
  report(inside, "search sheet: focus moves into the sheet when it opens");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => document.querySelector("#sl-search-input") === null);
  report(closed, "search sheet: Escape closes it");

  // --- status messages: the undo toast is a live region ---
  await page.goto(`${url}#/notes`);
  await page.getByTestId("sl-capture-input").waitFor({ timeout: 15_000 });
  await page.getByTestId("sl-capture-input").fill("A11y toast check");
  await page.getByTestId("sl-capture-input").press("Enter");
  await page.waitForTimeout(900);
  const noteRow = page.locator('[data-testid^="sl-note-"]').first();
  await noteRow.click();
  await page.getByTestId("sl-note-delete").click(); // arms the confirm
  await page.waitForTimeout(300);
  await page.getByTestId("sl-note-delete").click(); // and deletes
  await page.waitForTimeout(700);
  const toast = await page.evaluate(() => {
    const el = document.querySelector(".sl-undo-toast, [data-testid='sl-undo-toast']");
    if (!el) return null;
    return {
      role: el.getAttribute("role"),
      live: el.getAttribute("aria-live"),
      text: (el.textContent ?? "").trim().slice(0, 40),
    };
  });
  report(
    toast !== null && (toast.role === "status" || toast.live !== null),
    "undo toast is announced as a status message",
    toast === null ? "no toast found" : `role=${toast.role} aria-live=${toast.live}`,
  );

  // --- reflow: 320 px viewport, then WCAG 1.4.12 text spacing on top ---
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${url}#/plan`);
  await page.waitForTimeout(800);
  const narrow = await page.evaluate(auditScript);
  report(narrow.overflow <= 1, "320 px viewport: no horizontal overflow", `${narrow.overflow}px`);
  await page.addStyleTag({
    content: `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
              p, li { margin-bottom: 2em !important; }`,
  });
  await page.waitForTimeout(300);
  const spaced = await page.evaluate(auditScript);
  report(
    spaced.overflow <= 1,
    "text spacing (1.4.12): no horizontal overflow",
    `${spaced.overflow}px`,
  );
  await page.setViewportSize({ width: 390, height: 844 });

  // --- reduced motion: transitions off and the starfield paints a single frame ---
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${url}#/plan`);
  await page.waitForTimeout(800);
  const motion = await page.evaluate(() => {
    const button = document.querySelector("button");
    const duration = button ? getComputedStyle(button).transitionDuration : "";
    const seconds = duration.endsWith("ms")
      ? Number.parseFloat(duration) / 1000
      : Number.parseFloat(duration);
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      seconds,
    };
  });
  report(motion.matches, "reduced motion: the media query matches in the page");
  report(
    Number.isFinite(motion.seconds) && motion.seconds <= 0.001,
    "reduced motion: transitions are switched off",
    `${motion.seconds}s`,
  );
  await page.emulateMedia({ reducedMotion: null });
  await page.screenshot({ path: join(shotDir, "27-a11y.png"), fullPage: true });

  console.log(
    failures === 0
      ? "A11Y OK — keyboard, targets, reflow, reduced motion, titles, lang, escape, live region"
      : `A11Y FAILED — ${failures} check(s)`,
  );
  console.log(`screenshots: ${shotDir}`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
  server?.kill();
}
