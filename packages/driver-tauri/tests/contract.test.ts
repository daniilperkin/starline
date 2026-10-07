import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ContractHarness } from "@starline/db/testing";
import { runStorageDriverContract } from "@starline/db/testing";

import { TauriStorageDriver } from "../src/driver";
import { StdioTransport } from "../src/stdio-transport";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = join(packageRoot, "..", "..");
const binName = process.platform === "win32" ? "starline-storage.exe" : "starline-storage";
const binPath = join(repoRoot, "target", "debug", binName);

function ensureCliBuilt(): void {
  if (existsSync(binPath) && process.env.STARLINE_REBUILD_CLI !== "1") return;
  execFileSync("node", [join(repoRoot, "scripts", "cargo.mjs"), "build"], {
    stdio: "inherit",
    cwd: repoRoot,
  });
}

async function makeHarness(): Promise<ContractHarness> {
  ensureCliBuilt();
  const dir = await mkdtemp(join(tmpdir(), "starline-contract-"));
  const path = join(dir, "project.starline");
  const snapshotPath = join(dir, "snapshot.starline");
  const transports: StdioTransport[] = [];
  const newDriver = async (): Promise<TauriStorageDriver> => {
    const transport = new StdioTransport({
      command: binPath,
      env: { STARLINE_LOCK_STALE_MS: "500" },
    });
    transports.push(transport);
    return new TauriStorageDriver(transport, { watchIntervalMs: 250 });
  };
  const driver = await newDriver();
  return {
    driver,
    path,
    snapshotPath,
    newDriver,
    touchFile: async () => {
      const future = new Date(Date.now() + 5000);
      await utimes(path, future, future);
    },
    cleanup: async () => {
      for (const transport of transports) {
        try {
          await transport.dispose();
        } catch {
          // The child may already be gone.
        }
      }
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

runStorageDriverContract(
  "native (rusqlite via stdio)",
  { locking: true, externalChange: true, multiInstance: true },
  makeHarness,
);
