import {
  computeSnapshotDiff,
  extractEntity,
  listRestorableEntities,
  listSnapshotRecords,
  planRetention,
  type RestorableKind,
  readRecordCounts,
  reconcileSnapshotRecords,
  recordSnapshot,
  restoreEntityFromSnapshot,
  type SnapshotDiff,
  type SnapshotReason,
  type SnapshotRestoreResult,
} from "@starline/core";
import { ensureDeviceFolder, MIRROR_SUBDIR, writeDeviceFile } from "./deviceStorage";
import type { LibrarySession } from "./session";
import { type OpenedLibrary, openLibraryFully } from "./storage";

/**
 * Web snapshot store (spec §4.5.3): a `VACUUM INTO` copy of the live database, exported out of
 * the sahpool and written as a plain OPFS file under `starline-snapshots/`. The pool is a flat
 * namespace shared with libraries, so the bytes leave it immediately — snapshots survive
 * independently, and the pool stays at one slot per open library.
 *
 * Slice 11 adds the other direction: previewing and restoring a snapshot needs those bytes back
 * INSIDE the pool, and the only supported ingress is the worker's `import_file` op (the pool
 * stores files under opaque slot names, so writing them from the page is impossible). A preview
 * imports the snapshot as a temporary pool file, opens it read-only beside the live database,
 * and unlinks it again.
 */
const SNAPSHOT_DIR = "starline-snapshots";
const LAST_ACTIVITY_WINDOW_MS = 15 * 60 * 1000;
const OPEN_STALE_MS = 60 * 60 * 1000;

export type { SnapshotReason };

export interface SnapshotEntry {
  /** OPFS file name — `<library>-YYYYMMDD-HHmmss-<reason>.starline`. */
  name: string;
  byteSize: number;
  createdAt: number;
  reason: SnapshotReason;
  label: string;
}

export interface SnapshotPreview {
  entry: SnapshotEntry;
  diff: SnapshotDiff;
  entities: Array<{ kind: RestorableKind; id: string; name: string }>;
}

function snapshotsDir(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage
    .getDirectory()
    .then((root) => root.getDirectoryHandle(SNAPSHOT_DIR, { create: true }));
}

function stamp(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

/**
 * The library name as the SNAPSHOT files use it. A session created on this device carries the
 * name the writer typed ("My Novel") while a session opened from the start screen carries the
 * pool's encoded name ("My%20Novel") — without this, snapshots would vanish from the list after
 * a reload.
 */
function libraryKey(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

const REASON_RE =
  /-(open|activity|manual|pre_migration|pre_import|pre_bulk_delete|pre_restore)\.starline$/;

function parseEntry(name: string, byteSize: number): SnapshotEntry | null {
  // <library>-YYYYMMDD-HHmmss-<reason>.starline — library names may contain dashes, so match
  // the timestamp from the right.
  const match = name.match(/-(\d{8})-(\d{6})-(\w+)\.starline$/);
  if (!match || !REASON_RE.test(name)) return null;
  const day = match[1] ?? "";
  const time = match[2] ?? "";
  const createdAt = new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  ).getTime();
  return {
    name,
    byteSize,
    createdAt,
    reason: (match[3] ?? "activity") as SnapshotReason,
    label: "",
  };
}

/** All snapshots for a library, newest first. */
export async function listSnapshots(libraryName: string): Promise<SnapshotEntry[]> {
  const dir = await snapshotsDir();
  const entries: SnapshotEntry[] = [];
  const prefix = `${sanitize(libraryKey(libraryName))}-`;
  for await (const [name, handle] of dir.entries()) {
    if (!name.startsWith(prefix) || handle.kind !== "file") continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    const entry = parseEntry(name, file.size);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export async function lastSnapshotAt(libraryName: string): Promise<number | null> {
  const entries = await listSnapshots(libraryName);
  return entries[0]?.createdAt ?? null;
}

async function readSnapshotBytes(name: string): Promise<Uint8Array> {
  const dir = await snapshotsDir();
  const handle = await dir.getFileHandle(name, { create: false });
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function writeSnapshotBytes(name: string, bytes: Uint8Array): Promise<void> {
  const dir = await snapshotsDir();
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await writable.write(copy);
  await writable.close();
}

/**
 * Takes a snapshot: `VACUUM INTO` a pool temp file, copy the bytes out into OPFS, index the
 * file in `snapshot_record`, thin the store, mirror it if a mirror folder is configured.
 */
export async function takeSnapshot(
  session: LibrarySession,
  reason: SnapshotReason,
  label = "",
): Promise<SnapshotEntry> {
  const createdAt = Date.now();
  const stampText = stamp(new Date(createdAt));
  const tempName = `snap-tmp-${createdAt}.starline`;
  await session.driver.snapshot(tempName);
  try {
    const { bytes } = await session.transport.request<{ bytes: Uint8Array }>("export_file", {
      path: tempName,
    });
    const name = `${sanitize(libraryKey(session.name))}-${stampText}-${reason}.starline`;
    await writeSnapshotBytes(name, bytes);
    const entry: SnapshotEntry = { name, byteSize: bytes.byteLength, createdAt, reason, label };
    // The index is convenience only — the file above is the artefact. A failure here must not
    // fail the snapshot.
    await indexSnapshot(session, entry).catch(() => undefined);
    await pruneSnapshots(session.name).catch(() => 0);
    void mirrorSnapshot(entry);
    return entry;
  } finally {
    await session.transport.request("unlink", { path: tempName }).catch(() => undefined);
  }
}

/** Writes the `snapshot_record` row for a file that now exists. */
export async function indexSnapshot(session: LibrarySession, entry: SnapshotEntry): Promise<void> {
  const counts = await readRecordCounts(session.driver);
  await recordSnapshot(session.driver, {
    fileName: entry.name,
    createdAt: entry.createdAt,
    reason: entry.reason,
    byteSize: entry.byteSize,
    schemaVersion: counts.schemaVersion,
    wordCount: counts.wordCount,
    sceneCount: counts.sceneCount,
    label: entry.label,
  });
}

/** What the Backups screen shows per file: the file store plus the index row when there is one. */
export async function listSnapshotsWithRecords(
  session: LibrarySession,
): Promise<Array<SnapshotEntry & { wordCount: number; sceneCount: number }>> {
  const files = await listSnapshots(session.name);
  let records: Awaited<ReturnType<typeof listSnapshotRecords>> = [];
  try {
    records = await listSnapshotRecords(session.driver);
  } catch {
    // A database from before this table was used simply has no index.
  }
  const byFile = new Map(records.map((record) => [record.fileName, record]));
  return files.map((file) => ({
    ...file,
    label: byFile.get(file.name)?.label ?? file.label,
    wordCount: byFile.get(file.name)?.wordCount ?? 0,
    sceneCount: byFile.get(file.name)?.sceneCount ?? 0,
  }));
}

/** Aligns `snapshot_record` with the files that actually exist (spec §3.9). */
export async function reconcileSnapshotIndex(
  session: LibrarySession,
): Promise<{ added: number; removed: number }> {
  const files = await listSnapshots(session.name);
  return reconcileSnapshotRecords(session.driver, files);
}

/**
 * Retention (spec §4.5.3): the policy lives in core and is pure; this executes its plan.
 * Pinned files (manual / pre_*) and the newest file are never removed.
 */
export async function pruneSnapshots(libraryName: string): Promise<number> {
  const entries = await listSnapshots(libraryName);
  const plan = planRetention(entries, Date.now());
  if (plan.remove.length === 0) return 0;
  const dir = await snapshotsDir();
  let removed = 0;
  for (const name of plan.remove) {
    await dir.removeEntry(name).catch(() => undefined);
    removed += 1;
  }
  return removed;
}

/** A read-only runner over a second connection in the storage worker. */
function readOnlyRunner(session: LibrarySession) {
  return {
    query: <T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) =>
      session.transport.request<T[]>("ro_query", { sql, params }),
  };
}

/** Imports a snapshot into the pool as a temp file, hands it to `read`, then unlinks it. */
async function withImportedSnapshot<T>(
  session: LibrarySession,
  name: string,
  read: (runner: ReturnType<typeof readOnlyRunner>) => Promise<T>,
): Promise<T> {
  const bytes = await readSnapshotBytes(name);
  const tempName = `snap-view-${Date.now()}.starline`;
  await session.transport.request("import_file", { name: tempName, bytes });
  try {
    await session.transport.request("open_ro", { path: tempName });
    try {
      return await read(readOnlyRunner(session));
    } finally {
      await session.transport.request("ro_close", {}).catch(() => undefined);
    }
  } finally {
    await session.transport.request("unlink", { path: tempName }).catch(() => undefined);
  }
}

/** Read-only look at a snapshot: what changed since, and what could be restored from it. */
export async function previewSnapshot(
  session: LibrarySession,
  entry: SnapshotEntry,
): Promise<SnapshotPreview> {
  return withImportedSnapshot(session, entry.name, async (runner) => {
    const [diff, entities] = await Promise.all([
      computeSnapshotDiff(session.driver, runner),
      listRestorableEntities(runner),
    ]);
    return { entry, diff, entities };
  });
}

/**
 * Restores a snapshot (spec §4.5.3): snapshot the CURRENT state first, then replace the library
 * file with the snapshot's bytes and reopen. Returns the freshly opened session so the caller
 * can adopt it — the restore deliberately ends with a new worker, because the pool's file
 * handles must be released before the file can be replaced.
 */
export async function restoreSnapshot(
  session: LibrarySession,
  entry: SnapshotEntry,
): Promise<{ guard: SnapshotEntry; opened: OpenedLibrary }> {
  const guard = await takeSnapshot(session, "pre_restore", `before restoring ${entry.name}`);
  const bytes = await readSnapshotBytes(entry.name);
  const libraryName = session.name;

  // Close the live database and its worker: the pool's access handles must be gone before the
  // file can be unlinked and re-imported.
  const { closeLibrary, replacePoolFile } = await import("./storage");
  await closeLibrary(session);
  await replacePoolFile(`${libraryName}.starline`, bytes);
  const opened = await openLibraryFully(libraryName, false);
  return { guard, opened };
}

/** Pulls one character/scene/lore entry out of a snapshot into the live project. */
export async function restoreEntityFromFile(
  session: LibrarySession,
  entry: SnapshotEntry,
  kind: RestorableKind,
  id: string,
): Promise<SnapshotRestoreResult> {
  const extracted = await withImportedSnapshot(session, entry.name, (runner) =>
    extractEntity(runner, kind, id),
  );
  return session.driver.transaction((tx) => restoreEntityFromSnapshot(tx, extracted));
}

/**
 * Snapshot triggers (spec §4.5.3): on open when the newest snapshot is over an hour old, and
 * after 15 minutes of edit activity. Both are best-effort — a failed snapshot never blocks
 * the writer.
 */
export async function snapshotOnOpenIfStale(
  session: LibrarySession,
): Promise<SnapshotEntry | null> {
  try {
    const newest = await lastSnapshotAt(session.name);
    if (newest !== null && Date.now() - newest < OPEN_STALE_MS) return null;
    return await takeSnapshot(session, "open");
  } catch {
    return null;
  }
}

export async function snapshotAfterActivity(
  session: LibrarySession,
  lastActivityAt: number,
): Promise<SnapshotEntry | null> {
  try {
    const newest = await lastSnapshotAt(session.name);
    if (newest !== null && lastActivityAt - newest < LAST_ACTIVITY_WINDOW_MS) return null;
    return await takeSnapshot(session, "activity");
  } catch {
    return null;
  }
}

// ---- Mirror folder (spec §4.5.3, decision 20) ---------------------------------------------

/**
 * The mirror is a second, immutable copy of every snapshot in a folder the writer owns. Android
 * writes into the app's own files folder through Capacitor Filesystem (no permissions, no SAF
 * picker — decision 20); the web uses the File System Access API where the browser has it and
 * otherwise reports that mirroring is unavailable rather than pretending.
 */
const MIRROR_KEY = "starline.mirrorFolder";

export type MirrorKind = "capacitor" | "filesystem" | "unavailable";

export interface MirrorState {
  kind: MirrorKind;
  /** Folder name for display; empty when no folder has been chosen yet. */
  folder: string;
}

interface StoredMirror {
  kind: MirrorKind;
  folder: string;
}

function readStoredMirror(): StoredMirror {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return { kind: "unavailable", folder: "" };
    const parsed = JSON.parse(raw) as StoredMirror;
    return { kind: parsed.kind ?? "unavailable", folder: parsed.folder ?? "" };
  } catch {
    return { kind: "unavailable", folder: "" };
  }
}

export function mirrorState(): MirrorState {
  const stored = readStoredMirror();
  if (stored.folder.length > 0) return stored;
  return { kind: "unavailable", folder: "" };
}

export async function chooseMirrorFolder(): Promise<MirrorState> {
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    // Android: the app-scoped files folder — visible to a file manager or over USB, no permission
    // prompt, and the files are plain snapshots the writer can copy anywhere. Writing to the
    // shared /sdcard/Documents instead fails with EACCES on Android 11+ (caught by the slice-12
    // on-device export, which fixed the same mistake here).
    await ensureDeviceFolder(MIRROR_SUBDIR);
    const state: StoredMirror = { kind: "capacitor", folder: MIRROR_SUBDIR };
    localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
    return state;
  }
  const picker = (
    window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker;
  if (typeof picker !== "function") return { kind: "unavailable", folder: "" };
  try {
    const handle = await picker();
    await rememberDirectoryHandle(handle);
    const state: StoredMirror = { kind: "filesystem", folder: handle.name };
    localStorage.setItem(MIRROR_KEY, JSON.stringify(state));
    return state;
  } catch {
    // The writer cancelled the picker: keep whatever was configured before.
    return mirrorState();
  }
}

export async function clearMirrorFolder(): Promise<void> {
  localStorage.removeItem(MIRROR_KEY);
  await forgetDirectoryHandle();
}

/** Copies one snapshot into the mirror folder; silent when no mirror is configured. */
export async function mirrorSnapshot(entry: SnapshotEntry): Promise<boolean> {
  const state = mirrorState();
  if (state.folder.length === 0) return false;
  try {
    const bytes = await readSnapshotBytes(entry.name);
    if (state.kind === "capacitor") {
      await writeDeviceFile(MIRROR_SUBDIR, entry.name, bytes);
      return true;
    }
    if (state.kind === "filesystem") {
      const handle = await recallDirectoryHandle();
      if (!handle) return false;
      const file = await handle.getFileHandle(entry.name, { create: true });
      const writable = await file.createWritable();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await writable.write(copy);
      await writable.close();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Mirrors every snapshot not yet in the folder — used after configuring the folder. */
export async function mirrorAll(libraryName: string): Promise<number> {
  const entries = await listSnapshots(libraryName);
  let mirrored = 0;
  for (const entry of entries) {
    if (await mirrorSnapshot(entry)) mirrored += 1;
  }
  return mirrored;
}

// A FileSystemDirectoryHandle survives in IndexedDB, so the chosen folder keeps working across
// reloads (the permission prompt returns once per browser session — that is the platform's
// rule, not ours).
const HANDLE_DB = "starline-mirror";
const HANDLE_STORE = "handles";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, "mirror");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** `queryPermission`/`requestPermission` exist on every real FSA handle; TS's lib.dom lags. */
type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

async function recallDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await idb();
    const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readonly");
      const request = tx.objectStore(HANDLE_STORE).get("mirror");
      request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!handle) return null;
    const permissionHandle = handle as PermissionHandle;
    if (typeof permissionHandle.queryPermission !== "function") return handle;
    const permission = await permissionHandle.queryPermission({ mode: "readwrite" });
    if (permission === "granted") return handle;
    const asked = await permissionHandle.requestPermission?.({ mode: "readwrite" });
    return asked === "granted" ? handle : null;
  } catch {
    return null;
  }
}

async function forgetDirectoryHandle(): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).delete("mirror");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // nothing to forget
  }
}
