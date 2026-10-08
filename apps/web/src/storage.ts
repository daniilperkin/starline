import type { OpenResult } from "@starline/db";
import { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import type { LibrarySession } from "./session";

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

let startTransport: WorkerTransport | null = null;

/**
 * The start screen reuses ONE list worker for its lifetime. The sahpool VFS locks every pool
 * file it can see while its worker is alive, so a short-lived list worker per call raced the
 * session worker's open; one worker + an explicit release before opening removes the race
 * instead of retrying around it.
 */
async function listWithTransport(): Promise<string[]> {
  startTransport ??= new WorkerTransport();
  try {
    const { files } = await startTransport.request<{ files: string[] }>("list");
    // Pool names come back percent-encoded; keep them encoded for open() and let the UI
    // decode them for display.
    return files.map((file) => file.replace(/^\//, "")).sort();
  } catch (cause) {
    await releaseStartTransport(); // a wedged worker: next call starts clean
    throw cause;
  }
}

/** Lists the library files in the OPFS pool (worker op specific to the web backend). */
export function listLibraries(): Promise<string[]> {
  return listWithTransport();
}

/** Terminates the start-screen worker; its OPFS handles must be gone before a session opens. */
export async function releaseStartTransport(): Promise<void> {
  const transport = startTransport;
  startTransport = null;
  if (transport) await transport.dispose().catch(() => undefined);
}

const POOL_BUSY_RE = /NoModificationAllowedError|Access Handles cannot be created/;

/**
 * Opens a library for the start screen: releases the list worker first (its sahpool holds all
 * pool handles while alive), then opens — retrying briefly while the browser finishes
 * releasing a just-terminated worker's access handles (that release is asynchronous).
 */
export async function openLibrary(
  name: string,
  create: boolean,
): Promise<{ driver: TauriStorageDriver; transport: WorkerTransport; info: OpenResult }> {
  await releaseStartTransport();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 300));
    const { driver, transport } = createLibrarySession();
    try {
      const info = await driver.open({ path: `${name}.starline`, create, readOnly: false });
      return { driver, transport, info };
    } catch (cause) {
      lastError = cause;
      await driver.close().catch(() => undefined);
      await transport.dispose().catch(() => undefined);
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!POOL_BUSY_RE.test(message)) throw cause;
    }
  }
  throw lastError;
}
