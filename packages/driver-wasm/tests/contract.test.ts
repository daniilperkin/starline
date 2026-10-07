import type { ContractHarness } from "@starline/db/testing";
import { runStorageDriverContract } from "@starline/db/testing";
import { TauriStorageDriver } from "@starline/driver-tauri/driver";

import { WorkerTransport } from "../src/transport";

async function makeHarness(): Promise<ContractHarness> {
  const name = `project-${crypto.randomUUID()}.starline`;
  const snapshotPath = `snapshot-${crypto.randomUUID()}.starline`;
  const transports: WorkerTransport[] = [];
  const newDriver = async (): Promise<TauriStorageDriver> => {
    const transport = new WorkerTransport();
    transports.push(transport);
    return new TauriStorageDriver(transport);
  };
  const driver = await newDriver();
  return {
    driver,
    path: name,
    snapshotPath,
    newDriver,
    cleanup: async () => {
      for (const transport of transports) {
        try {
          await transport.dispose();
        } catch {
          // The worker may already be gone.
        }
      }
      const cleaner = new WorkerTransport();
      try {
        const removal = await cleaner.request<{ removed: boolean }>("unlink", { path: name });
        await cleaner.request("unlink", { path: snapshotPath });
        if (!removal.removed) console.log("[wasm-harness] primary file not removed:", name);
      } catch (error) {
        console.log("[wasm-harness] cleanup failed:", error);
      }
      await cleaner.dispose();
    },
  };
}

runStorageDriverContract(
  "web (sqlite-wasm over OPFS)",
  { locking: false, externalChange: false, multiInstance: false },
  makeHarness,
);
