#!/usr/bin/env node
// Offline-complete invariant (spec §5.2, decisions 15/18/23d): the app's own source must
// contain no network code paths. Scans apps/*/src and packages/*/src for network primitives; a
// line may opt out with a `no-network-ok: <reason>` comment. Scripts and tests are out of scope —
// this guards what ships in the bundle.
//
// Flavour awareness (decision 23d): the cloud-backup module is the one deliberate exception. In a
// default run those files are reported as skipped — they are not imported by the default artifact,
// and the default bundle is what the invariant protects. With STARLINE_CLOUD=1 they are scanned
// too, and every URL they contain must point at an allowlisted Google host.
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

// Files that exist only for the cloud flavour. They may contain network primitives, but only
// against the hosts Google documents for sign-in and Drive. The host rule applies to these files
// alone — other modules legitimately contain URIs that are namespaces, not endpoints (the DOCX
// exporter's OOXML namespaces, for one).
const CLOUD_FLAVOR_PATHS = [
  "packages/core/src/cloud/drive.ts",
  "packages/core/src/cloud/auth.ts",
  "apps/web/src/cloud/auth-web.ts",
  // Any new cloud file that touches the network belongs in this list, or the default run fails —
  // which is the point: the exception must be explicit and reviewable.
];

const CLOUD_HOST_ALLOWLIST = [
  "https://www.googleapis.com",
  "https://oauth2.googleapis.com",
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://accounts.google.com",
];

const cloudFlavor = process.env.STARLINE_CLOUD === "1";

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
const skipped = [];
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
    const path = relative(repoRoot, file).replaceAll("\\", "/");
    const isCloudFlavorFile = CLOUD_FLAVOR_PATHS.includes(path);
    if (isCloudFlavorFile && !cloudFlavor) {
      skipped.push(path);
      continue;
    }
    scanned++;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes("no-network-ok")) return;
      // Cloud-flavour files are allowed to use the network — that is the whole exception. In the
      // cloud run they are held to the host allowlist instead; in the default run they are skipped
      // entirely (above), so the default artifact is still checked strictly.
      if (!isCloudFlavorFile) {
        for (const pattern of PATTERNS) {
          if (pattern.re.test(line)) {
            violations.push(`${path}:${index + 1} [${pattern.name}] ${line.trim()}`);
          }
        }
      }
      if (!isCloudFlavorFile || !cloudFlavor) return;
      // Cloud flavour files: every URL literal must point at an allowlisted Google host.
      for (const match of line.matchAll(/["'`](https?:\/\/[^"'`\s]+)/g)) {
        let origin;
        try {
          origin = new URL(match[1]).origin;
        } catch {
          continue;
        }
        if (!CLOUD_HOST_ALLOWLIST.includes(origin)) {
          violations.push(`${path}:${index + 1} [host not allowed] ${match[1]}`);
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
for (const path of skipped) {
  console.log(`  cloud flavour, not in the default artifact: ${path}`);
}
console.log(
  `NO-NETWORK OK (${scanned} files scanned${cloudFlavor ? ", cloud flavour: hosts allowlisted" : ""})`,
);
