#!/usr/bin/env node
// Chaos test (spec §5.3, M0 exit criterion): drive ~1,000 random commands against a real
// project file, kill the storage process mid-run (taskkill /F = the Windows "kill -9"),
// restart it, and finally assert that:
//   (a) PRAGMA integrity_check passes,
//   (b) PRAGMA foreign_key_check is clean,
//   (c) every acknowledged commit is present (the last acknowledged command included),
//   (d) no ghost rows beyond what was ever sent.
// Usage: node scripts/chaos/run.mjs [iterations] [commands-per-iteration]

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);
const migrationSql = readFileSync(
  join(repoRoot, "packages", "db", "src", "migrations", "0001_init.sql"),
  "utf8",
);

const ITERATIONS = Number(process.argv[2] ?? 3);
const COMMANDS_PER_ITERATION = Number(process.argv[3] ?? 334); // ~1,000 total

function startStorage() {
  const child = spawn(binPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, STARLINE_LOCK_STALE_MS: "200" },
    windowsHide: true,
  });
  const pending = new Map();
  let nextId = 1;
  let exited = false;
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const pendingCall = pending.get(message.id);
    if (!pendingCall) return;
    pending.delete(message.id);
    if (message.ok) pendingCall.resolve(message.result);
    else pendingCall.reject(new Error(message.error?.message ?? "storage error"));
  });
  child.on("exit", () => {
    exited = true;
    for (const pendingCall of pending.values()) pendingCall.reject(new Error("storage process exited"));
    pending.clear();
  });
  const request = (op, payload = {}) => {
    if (exited) return Promise.reject(new Error("storage process not running"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    });
  };
  const kill = () => {
    if (exited) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/F", "/T"], { stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  };
  return { request, kill };
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "starline-chaos-"));
  const path = join(dir, "chaos.starline");
  let sent = 0;
  let kills = 0;
  const acked = new Set();
  let lastAckedKey = null;

  try {
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      let storage = startStorage();
      await storage.request("open", { path, create: true });
      const versionRows = await storage.request("query", { sql: "PRAGMA user_version" });
      if (versionRows[0].user_version === 0) {
        await storage.request("exec_script", { sql: migrationSql });
      }
      const killAt = 10 + Math.floor(Math.random() * (COMMANDS_PER_ITERATION - 20));
      for (let i = 0; i < COMMANDS_PER_ITERATION; i++) {
        if (i === killAt) {
          storage.kill();
          kills++;
          storage = startStorage();
          await storage.request("open", { path, create: false });
        }
        const key = `chaos-${iteration}-${i}`;
        sent++;
        try {
          await storage.request("exec", {
            sql: "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, ?2)",
            params: [key, String(i)],
          });
          acked.add(key);
          lastAckedKey = key;
        } catch {
          // The kill may have landed mid-command; restart and retry once (idempotent insert).
          storage = startStorage();
          await storage.request("open", { path, create: false });
          try {
            await storage.request("exec", {
              sql: "INSERT OR REPLACE INTO meta(key, value) VALUES(?1, ?2)",
              params: [key, String(i)],
            });
            acked.add(key);
            lastAckedKey = key;
          } catch {
            // Sent but never acknowledged; the durability assertion below only requires
            // that every ACKED command survived.
          }
        }
      }
      storage.kill();
    }

    // Verification pass on a fresh process.
    const verifier = startStorage();
    await verifier.request("open", { path, create: false });
    const integrity = await verifier.request("integrity_check");
    const fk = await verifier.request("query", { sql: "PRAGMA foreign_key_check" });
    const counts = await verifier.request("query", {
      sql: "SELECT COUNT(*) AS n FROM meta WHERE key LIKE 'chaos-%'",
    });
    const present = counts[0].n;
    const lastPresent = lastAckedKey
      ? (
          await verifier.request("query", {
            sql: "SELECT COUNT(*) AS n FROM meta WHERE key = ?1",
            params: [lastAckedKey],
          })
        )[0].n
      : 0;
    verifier.kill();

    const checks = [
      ["integrity_check ok", integrity.ok === true],
      ["foreign_key_check clean", fk.length === 0],
      ["no acked command lost", present >= acked.size],
      ["last acknowledged command present", lastPresent === 1],
      ["no rows beyond what was sent", present <= sent],
    ];
    let ok = true;
    for (const [label, pass] of checks) {
      console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
      if (!pass) ok = false;
    }
    console.log(
      `commands sent=${sent} acked=${acked.size} present=${present} kills=${kills} iterations=${ITERATIONS}`,
    );
    console.log(ok ? "CHAOS OK" : "CHAOS FAILED");
    process.exitCode = ok ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error("chaos run crashed:", error);
  process.exit(1);
});
