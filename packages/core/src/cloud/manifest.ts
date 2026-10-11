/**
 * Cloud snapshot manifest (slice 15, decision 18/23).
 *
 * The cloud holds immutable snapshot files plus one small JSON manifest per library. The manifest
 * is what the Backups → Cloud tab lists, so it must survive being written by an older app version
 * (tolerant parse) and must never be the reason a restore fails (the files themselves are the
 * truth; a manifest entry pointing at a missing file simply fails its download and is reported).
 *
 * Pure module: no Drive, no fetch, no DOM — the Drive client and the UI both build on it.
 */

export const CLOUD_MANIFEST_VERSION = 1;
export const CLOUD_MANIFEST_NAME = "manifest.json";

export interface CloudSnapshotEntry {
  /** File name inside the app folder, e.g. `2026-10-11T18-02-manual.starline`. */
  name: string;
  /** Drive file id, so a download does not have to search by name. */
  fileId: string;
  /** Epoch ms of the upload. */
  uploadedAt: number;
  /** Why the snapshot was taken (snapshot reason codes, e.g. `manual`, `on-open`, `activity`). */
  reason: string;
  /** Size of the uploaded file, for the list UI. */
  bytes: number;
  /** SHA-256 of the uploaded bytes, so a download can be verified before it is trusted. */
  sha256: string;
  /** Per-table row counts at snapshot time, shown in the list ("44 scenes · 4 characters"). */
  counts?: Record<string, number>;
}

export interface CloudManifest {
  version: number;
  /** Stable id of the library this manifest belongs to (its folder name in the cloud). */
  libraryId: string;
  /** Human-readable library name at last upload, for the restore list. */
  libraryName: string;
  updatedAt: number;
  entries: CloudSnapshotEntry[];
}

/** Tolerant parse: anything unexpected is "no usable manifest", never a crash. */
export function parseCloudManifest(text: string): CloudManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<CloudManifest>;
  if (candidate.version !== CLOUD_MANIFEST_VERSION) return null;
  if (typeof candidate.libraryId !== "string" || candidate.libraryId.length === 0) return null;
  if (!Array.isArray(candidate.entries)) return null;

  const entries = candidate.entries.filter(isEntry).map((entry) => ({ ...entry }));
  return {
    version: CLOUD_MANIFEST_VERSION,
    libraryId: candidate.libraryId,
    libraryName: typeof candidate.libraryName === "string" ? candidate.libraryName : "",
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
    entries,
  };
}

function isEntry(value: unknown): value is CloudSnapshotEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<CloudSnapshotEntry>;
  return (
    typeof entry.name === "string" &&
    entry.name.length > 0 &&
    typeof entry.fileId === "string" &&
    entry.fileId.length > 0 &&
    typeof entry.uploadedAt === "number" &&
    typeof entry.reason === "string" &&
    typeof entry.bytes === "number" &&
    typeof entry.sha256 === "string"
  );
}

export function serializeCloudManifest(manifest: CloudManifest): string {
  return `${JSON.stringify({ ...manifest, version: CLOUD_MANIFEST_VERSION }, null, 2)}\n`;
}

export function emptyManifest(libraryId: string, libraryName: string): CloudManifest {
  return { version: CLOUD_MANIFEST_VERSION, libraryId, libraryName, updatedAt: 0, entries: [] };
}

/**
 * Add or replace an entry, keyed by file name (a re-upload of the same snapshot replaces it), and
 * keep the list newest-first — the order the UI shows and the order "restore the latest" relies on.
 */
export function withEntry(manifest: CloudManifest, entry: CloudSnapshotEntry): CloudManifest {
  const entries = [entry, ...manifest.entries.filter((existing) => existing.name !== entry.name)];
  entries.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return { ...manifest, entries, updatedAt: Math.max(manifest.updatedAt, entry.uploadedAt) };
}

/** Drop an entry (after the file was deleted in the cloud), by Drive file id. */
export function withoutEntry(manifest: CloudManifest, fileId: string): CloudManifest {
  return { ...manifest, entries: manifest.entries.filter((entry) => entry.fileId !== fileId) };
}

/**
 * The retention policy, mirroring the local one (decision 23c): keep everything from the last
 * 24 hours, the newest snapshot of each of the last 60 days, and every manual snapshot.
 * Returns the entries to delete, oldest first.
 */
export function entriesBeyondRetention(
  manifest: CloudManifest,
  now: number,
  limits: { keepAllWindowMs: number; dailyKeepWindowMs: number },
): CloudSnapshotEntry[] {
  const keep = new Set<string>();
  const byDay = new Map<string, CloudSnapshotEntry>();

  for (const entry of manifest.entries) {
    const age = now - entry.uploadedAt;
    if (age <= limits.keepAllWindowMs) {
      keep.add(entry.fileId);
      continue;
    }
    if (entry.reason === "manual") {
      keep.add(entry.fileId);
      continue;
    }
    if (age > limits.dailyKeepWindowMs) continue;
    const day = new Date(entry.uploadedAt).toISOString().slice(0, 10);
    const best = byDay.get(day);
    if (!best || entry.uploadedAt > best.uploadedAt) byDay.set(day, entry);
  }

  for (const entry of byDay.values()) keep.add(entry.fileId);
  return manifest.entries
    .filter((entry) => !keep.has(entry.fileId))
    .sort((a, b) => a.uploadedAt - b.uploadedAt);
}
