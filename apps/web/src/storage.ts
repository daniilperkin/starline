import { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import type { LibrarySession } from "./App";

/**
 * M0 storage factory for the web build: libraries live in the OPFS sahpool.
 * The Tauri shell will construct the same driver class over an invoke transport —
 * one StorageDriver interface for both targets (spec §2.3.2).
 */
export function createLibrarySession(): {
  driver: TauriStorageDriver;
  transport: WorkerTransport;
} {
  const transport = new WorkerTransport();
  return { driver: new TauriStorageDriver(transport), transport };
}

/**
 * Closes a library and tears down its storage worker. The sahpool VFS locks the pool per
 * instance, so the worker must be gone before the start screen can list libraries again
 * from a fresh worker.
 */
export async function closeLibrary(session: LibrarySession): Promise<void> {
  await session.driver.close();
  await session.transport.dispose();
}

let listChain: Promise<string[]> = Promise.resolve([]);

/** Lists the library files in the OPFS pool (worker op specific to the web backend). */
export function listLibraries(): Promise<string[]> {
  // Serialize list calls: every call spawns its own pool instance, and concurrent installs
  // contend for the sahpool lock (React StrictMode mounts the start screen twice in dev).
  listChain = listChain.catch(() => []).then(() => listWithRetry());
  return listChain;
}

async function listWithRetry(): Promise<string[]> {
  // The first attempt can race a just-terminated storage worker (close → back to the start
  // screen); sahpool releases its handles asynchronously, so retry briefly before failing.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 350));
    const transport = new WorkerTransport();
    try {
      const { files } = await transport.request<{ files: string[] }>("list");
      // Pool names come back percent-encoded; keep them encoded for open() and let the UI
      // decode them for display.
      return files.map((file) => file.replace(/^\//, "")).sort();
    } catch (cause) {
      lastError = cause;
    } finally {
      await transport.dispose();
    }
  }
  throw lastError;
}
