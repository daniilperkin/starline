#!/usr/bin/env node
// Runs cargo with the right environment per platform:
// - Windows: through scripts/win/cargo.cmd so vcvars64 (MSVC linker + Windows SDK) is loaded.
// - Elsewhere: plain cargo.
// Usage: node scripts/cargo.mjs <cargo args...>
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const isWin = process.platform === "win32";
const res = isWin
  ? spawnSync("cmd.exe", ["/d", "/s", "/c", `scripts\\win\\cargo.cmd ${args.join(" ")}`], {
      cwd: root,
      stdio: "inherit",
    })
  : spawnSync("cargo", args, { cwd: root, stdio: "inherit" });

process.exit(res.status ?? 1);
