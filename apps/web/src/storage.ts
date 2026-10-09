import type { OpenResult } from "@starline/db";
import { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import { markSessionClean } from "./health";
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
 * Closes a library and tears down its storage worker. Writes the clean-shutdown marker first
 * (spec §2.3.3 crash detection) — best effort, a failed marker only costs a false-positive
 * recovery banner next time. The sahpool VFS locks the pool per instance, so the worker must
 * be gone before the start screen can list libraries again from a fresh worker.
 */
export async function closeLibrary(session: LibrarySession): Promise<void> {
  await markSessionClean(session.driver).catch(() => undefined);
  await session.driver.close();
  await session.transport.dispose();
}

let startTransport: WorkerTransport | null = null;
/** Bumped on every deliberate release so an in-flight list cannot resurrect a retired worker. */
const startGeneration = 0;

/** Internal temp files (in-flight snapshots) must never surface as libraries. */
const TEMP_FILE_RE = /^snap-tmp-.*\.starline$/;
/** SQLite sidecars — a crash leaves a rollback journal for recovery; hide it, never delete it. */
const SIDECAR_RE = /-(journal|wal|shm)$/;

function isInternalPoolFile(name: string): boolean {
  const decoded = decodeURIComponent(name);
  return TEMP_FILE_RE.test(decoded) || SIDECAR_RE.test(decoded);
}

async function requestPoolList(transport: WorkerTransport): Promise<string[]> {
  const { files } = await transport.request<{ files: string[] }>("list");
  // Pool names come back percent-encoded; keep them encoded for open() and let the UI
  // decode them for display.
  return files.map((file) => file.replace(/^\//, "")).sort();
}

/**
 * The start screen reuses ONE list worker for its lifetime. The sahpool VFS locks every pool
 * file it can see while its worker is alive, so a short-lived list worker per call raced the
 * session worker's open; one worker + an explicit release before opening removes the race
 * instead of retrying around it. A reload can still catch the previous session worker mid-
 * release (that is asynchronous), so the list gets one calm retry before the start screen
 * shows an error.
 */
async function listWithTransport(): Promise<string[]> {
  startTransport ??= new WorkerTransport();
  const generation = startGeneration;
  try {
    return await requestPoolList(startTransport);
  } catch (firstError) {
    // openLibrary() releases the transport on purpose before opening, which fails any list
    // still in flight; that release must win, or a fresh list worker holds the pool's access
    // handles and blocks the open it was making way for.
    if (generation !== startGeneration) throw firstError;
    await releaseStartTransport();
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (generation !== startGeneration) throw firstError;
    startTransport = new WorkerTransport();
    try {
      return await requestPoolList(startTransport);
    } catch {
      await releaseStartTransport();
      throw firstError;
    }
  }
}

/**
 * Lists the library files in the OPFS pool (worker op specific to the web backend). Snapshot
 * temp files (`snap-tmp-*`, spec §4.5.3) and SQLite sidecars (`*-journal`/`-wal`/`-shm`, left
 * by a crash mid-write and needed for recovery on the next open) are hidden — a leftover must
 * never read as a library.
 */
export async function listLibraries(): Promise<string[]> {
  const files = await listWithTransport();
  return files.filter((name) => !isInternalPoolFile(name));
}

/**
 * Deletes orphaned snapshot temp files from the pool. Called by the start screen before
 * listing; best effort — a wedged worker just skips the sweep.
 */
export async function cleanupTempFiles(): Promise<number> {
  startTransport ??= new WorkerTransport();
  let removed = 0;
  try {
    const { files } = await startTransport.request<{ files: string[] }>("list");
    for (const file of files) {
      const name = file.replace(/^\//, "");
      if (!TEMP_FILE_RE.test(decodeURIComponent(name))) continue;
      await startTransport.request("unlink", { path: name }).catch(() => undefined);
      removed += 1;
    }
  } catch {
    await releaseStartTransport();
  }
  return removed;
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
  // The released worker's access handles free up asynchronously; on a slow device (and with a
  // 64-slot pool) that can take a moment, so allow ~5 s of retries before giving up.
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400));
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
