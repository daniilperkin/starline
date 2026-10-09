import type { LibrarySession } from "./session";

/**
 * Web snapshot store (spec §4.5.3): a `VACUUM INTO` copy of the live database, exported out
 * of the sahpool and written as a plain OPFS file under `starline-snapshots/`. The pool is a
 * flat namespace shared with libraries, so the bytes leave it immediately — snapshots survive
 * independently and the pool stays at one slot per open library.
 */
const SNAPSHOT_DIR = "starline-snapshots";
const LAST_ACTIVITY_WINDOW_MS = 15 * 60 * 1000;
const OPEN_STALE_MS = 60 * 60 * 1000;
const KEEP_ALL_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_KEEP_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const HARD_CAP = 40;

export type SnapshotReason = "open" | "activity" | "manual";

export interface SnapshotEntry {
  /** OPFS file name — `<library>-YYYYMMDD-HHmmss-<reason>.starline`. */
  name: string;
  byteSize: number;
  createdAt: number;
  reason: SnapshotReason | "other";
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

function parseEntry(name: string, byteSize: number): SnapshotEntry | null {
  // <library>-YYYYMMDD-HHmmss-<reason>.starline — library names may contain dashes, so match
  // the timestamp from the right.
  const match = name.match(/-(\d{8})-(\d{6})-(open|activity|manual)\.starline$/);
  if (!match) return null;
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
  return { name, byteSize, createdAt, reason: match[3] as SnapshotReason };
}

/** All snapshots for a library, newest first. */
export async function listSnapshots(libraryName: string): Promise<SnapshotEntry[]> {
  const dir = await snapshotsDir();
  const prefix = `${sanitize(libraryName)}-`;
  const entries: SnapshotEntry[] = [];
  for await (const handle of dir.values()) {
    if (handle.kind !== "file" || !handle.name.startsWith(prefix)) continue;
    const file = await handle.getFile();
    const entry = parseEntry(handle.name, file.size);
    if (entry !== null) entries.push(entry);
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Newest snapshot time across all libraries (the dashboard "Last backup" reads this). */
export async function lastSnapshotAt(libraryName: string): Promise<number | null> {
  const entries = await listSnapshots(libraryName);
  return entries[0]?.createdAt ?? null;
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_");
}

/**
 * Takes a snapshot now: VACUUM INTO a temp pool slot, export the bytes, write the OPFS file,
 * free the slot. Returns the new entry.
 */
export async function takeSnapshot(
  session: LibrarySession,
  reason: SnapshotReason,
): Promise<SnapshotEntry> {
  const createdAt = Date.now();
  const stampText = stamp(new Date(createdAt));
  const tempName = `snap-tmp-${createdAt}.starline`;
  await session.driver.snapshot(tempName);
  try {
    const { bytes } = await session.transport.request<{ bytes: Uint8Array }>("export_file", {
      path: tempName,
    });
    const dir = await snapshotsDir();
    const name = `${sanitize(session.name)}-${stampText}-${reason}.starline`;
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    // Copy into a fresh buffer: the worker-transported view is typed ArrayBufferLike and
    // may not satisfy FileSystemWriteChunkType's ArrayBuffer view.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await writable.write(copy);
    await writable.close();
    const entry: SnapshotEntry = { name, byteSize: bytes.byteLength, createdAt, reason };
    await pruneSnapshots(session.name);
    return entry;
  } finally {
    await session.transport.request("unlink", { path: tempName }).catch(() => undefined);
  }
}

/**
 * Basic retention (spec §4.5.3, phone-scope): keep everything from the last 24 h, then the
 * newest snapshot per day for 60 days; manual snapshots are kept; a hard cap of 40 files
 * thins oldest-first but never touches the newest or a manual snapshot.
 */
export async function pruneSnapshots(libraryName: string): Promise<number> {
  const entries = await listSnapshots(libraryName); // newest first
  const newest = entries[0];
  if (!newest) return 0;
  const now = Date.now();
  const keep = new Set<string>([newest.name]);
  const seenDays = new Set<string>();
  for (const entry of entries) {
    if (entry.reason === "manual") {
      keep.add(entry.name);
      continue;
    }
    const age = now - entry.createdAt;
    if (age <= KEEP_ALL_WINDOW_MS) {
      keep.add(entry.name);
      continue;
    }
    if (age <= DAILY_KEEP_WINDOW_MS) {
      const day = new Date(entry.createdAt).toDateString();
      if (!seenDays.has(day)) {
        seenDays.add(day);
        keep.add(entry.name);
      }
    }
  }
  if (keep.size > HARD_CAP) {
    for (const entry of [...entries].reverse()) {
      // oldest first
      if (keep.size <= HARD_CAP) break;
      if (entry.reason === "manual" || entry.name === newest.name) continue;
      keep.delete(entry.name);
    }
  }
  const dir = await snapshotsDir();
  let removed = 0;
  for (const entry of entries) {
    if (keep.has(entry.name)) continue;
    await dir.removeEntry(entry.name).catch(() => undefined);
    removed++;
  }
  return removed;
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
