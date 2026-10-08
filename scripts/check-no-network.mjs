#!/usr/bin/env node
// Offline-complete invariant (spec §5.2, decisions 15/18): the app's own source must contain
// no network code paths. Scans apps/*/src and packages/*/src for network primitives; a line
// may opt out with a `no-network-ok: <reason>` comment. Scripts and tests are out of scope —
// this guards what ships in the bundle.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const PATTERNS = [
  { name: "fetch()", re: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", re: /\bWebSocket\b/ },
  { name: "EventSource", re: /\bEventSource\b/ },
  { name: "sendBeacon", re: /\bsendBeacon\b/ },
  { name: "axios", re: /\baxios\b/ },
  { name: "node http(s) import", re: /from\s+["'](?:node:)?https?["']/ },
];

const roots = [join(repoRoot, "apps", "web", "src")];
const packagesDir = join(repoRoot, "packages");
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  roots.push(join(packagesDir, entry.name, "src"));
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* walk(path);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield path;
    }
  }
}

const violations = [];
let scanned = 0;

for (const root of roots) {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    continue;
  }
  if (!stat.isDirectory()) continue;
  for (const file of walk(root)) {
    scanned++;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes("no-network-ok")) return;
      for (const pattern of PATTERNS) {
        if (pattern.re.test(line)) {
          const path = relative(repoRoot, file).replaceAll("\\", "/");
          violations.push(`${path}:${index + 1} [${pattern.name}] ${line.trim()}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("NO-NETWORK FAILED — network primitives found in app source:");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log(`NO-NETWORK OK (${scanned} files scanned)`);
