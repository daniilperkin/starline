import type { MigrationReport, OpenResult } from "@starline/db";
import { LATEST_SCHEMA_VERSION, runMigrations } from "@starline/db";
import { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import {
  assessSessionHealth,
  markSessionClean,
  markSessionOpen,
  purgeTrashOnOpen,
  type SessionHealth,
} from "./health";
import type { LibrarySession } from "./session";
import { takeSnapshot } from "./snapshots";

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

/** Everything the start screen (and a restore) needs after opening a library. */
export interface OpenedLibrary {
  driver: TauriStorageDriver;
  transport: WorkerTransport;
  name: string;
  info: OpenResult;
  report: MigrationReport;
  health: SessionHealth;
}

/**
 * The full open sequence (spec §2.3.3, §5.3): open the file, migrate, read the health snapshot
 * BEFORE overwriting the crash marker, mark the session open, purge expired trash. Shared by the
 * start screen and by a snapshot restore — a restore is just "open again after swapping bytes",
 * and it must not run a different, weaker path than a normal open.
 */
export async function openLibraryFully(name: string, create: boolean): Promise<OpenedLibrary> {
  const { driver, transport, info } = await openLibrary(name, create);
  try {
    // A file that is about to be migrated gets a snapshot first, taken while it is still the old
    // schema: this is the only moment a copy of the pre-update state exists. A failure here must
    // not block the open — the migration itself is transactional, and the snapshot is insurance.
    const pending = await driver.query<{ user_version: number }>("PRAGMA user_version");
    const pendingVersion = pending[0]?.user_version ?? 0;
    if (pendingVersion > 0 && pendingVersion < LATEST_SCHEMA_VERSION) {
      await takeSnapshot(
        { driver, transport, name } as unknown as LibrarySession,
        "pre_migration",
        `v${pendingVersion}`,
      ).catch(() => undefined);
    }
    const report = await runMigrations(driver);
    const health = await assessSessionHealth(driver);
    await markSessionOpen(driver);
    await purgeTrashOnOpen(driver);
    if (create) {
      // Spec §5.4.1: ask the browser to make this origin's storage persistent on first creation.
      void navigator.storage?.persist?.();
    }
    return { driver, transport, name, info, report, health };
  } catch (cause) {
    await driver.close().catch(() => undefined);
    await transport.dispose().catch(() => undefined);
    throw cause;
  }
}

/**
 * Replaces a library file inside the pool with new bytes (snapshot restore, and slice 12's
 * "open an external .starline"). Runs on a dedicated short-lived worker: the pool's access
 * handles must be released by every other worker before the file can be unlinked, and the caller
 * is expected to have closed its session already.
 */
export async function replacePoolFile(name: string, bytes: Uint8Array): Promise<void> {
  const transport = new WorkerTransport();
  try {
    // The worker resolves the pool's canonical (encoded) file name and replaces it in one step:
    // doing unlink + import from here raced the encoding and left a duplicate file behind.
    await transport.request("replace_file", { name, bytes });
  } finally {
    await transport.dispose().catch(() => undefined);
  }
}
