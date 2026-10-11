/**
 * Cloud backup orchestration (slice 15, decisions 18/23).
 *
 * The rules, in one place: which local snapshots still need uploading, what the cloud manifest
 * looks like afterwards, and what the retention policy says to delete. Everything it touches is
 * injected — the Drive client, the clock, the snapshot bytes — so the whole flow is testable
 * without a network and reusable by both the APK and the PWA.
 *
 * The cloud holds immutable snapshot files plus one `manifest.json` per library. Uploads are
 * idempotent by file name: a snapshot that is already listed is never uploaded twice, which is
 * what makes a retry after a failed token refresh safe.
 */

import type { DriveClient, DriveFile } from "./drive";
import {
  CLOUD_MANIFEST_NAME,
  type CloudManifest,
  type CloudSnapshotEntry,
  emptyManifest,
  entriesBeyondRetention,
  parseCloudManifest,
  serializeCloudManifest,
  withEntry,
  withoutEntry,
} from "./manifest";

export const SNAPSHOT_EXTENSION = ".starline";

/** The default thinning, mirroring the local one (decision 23c). */
export const CLOUD_KEEP_ALL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CLOUD_DAILY_KEEP_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

// The UTF-8 codec, read off globalThis so this package needs no DOM lib (same reason the Drive
// client declares its fetch surface structurally).
interface Utf8Encoder {
  encode(input?: string): Uint8Array;
}
interface Utf8Decoder {
  decode(input?: Uint8Array): string;
}
const utf8Globals = globalThis as unknown as {
  TextEncoder: new () => Utf8Encoder;
  TextDecoder: new (label?: string) => Utf8Decoder;
};

export interface SnapshotCandidate {
  /** File name to use in the cloud, e.g. `2026-10-11T18-02-manual.starline`. */
  name: string;
  bytes: Uint8Array;
  reason: string;
  createdAt: number;
  sha256: string;
  counts?: Record<string, number>;
}

export interface BackupDeps {
  drive: DriveClient;
  libraryId: string;
  libraryName: string;
  now: number;
  limits?: { keepAllWindowMs: number; dailyKeepWindowMs: number };
}

export interface BackupResult {
  uploaded: CloudSnapshotEntry[];
  deleted: string[];
  skipped: string[];
  manifest: CloudManifest;
}

/** `2026-10-11T18-02-manual.starline` — sortable, readable, unique per minute per reason. */
export function snapshotFileName(createdAt: number, reason: string): string {
  const iso = new Date(createdAt).toISOString().slice(0, 16).replaceAll(":", "-");
  const safeReason = reason.replaceAll(/[^a-z0-9-]/gi, "-").toLowerCase() || "snapshot";
  return `${iso}-${safeReason}${SNAPSHOT_EXTENSION}`;
}

function findManifest(files: DriveFile[]): DriveFile | undefined {
  return files.find((file) => file.name === CLOUD_MANIFEST_NAME);
}

/**
 * Upload what is missing, thin what retention says is old, rewrite the manifest.
 * A snapshot that fails to upload is simply not listed, so the next run retries it; real failures
 * (auth, API disabled) surface from the first Drive call.
 */
export async function backupSnapshots(
  deps: BackupDeps,
  candidates: SnapshotCandidate[],
): Promise<BackupResult> {
  const { drive, libraryId, libraryName, now } = deps;
  const limits = deps.limits ?? {
    keepAllWindowMs: CLOUD_KEEP_ALL_WINDOW_MS,
    dailyKeepWindowMs: CLOUD_DAILY_KEEP_WINDOW_MS,
  };

  const files = await drive.list();
  const manifestFile = findManifest(files);
  let manifest: CloudManifest = emptyManifest(libraryId, libraryName);
  if (manifestFile) {
    const text = new utf8Globals.TextDecoder().decode(await drive.download(manifestFile.id));
    manifest = parseCloudManifest(text) ?? manifest;
  }
  manifest = { ...manifest, libraryName: libraryName || manifest.libraryName };

  const known = new Set(manifest.entries.map((entry) => entry.name));
  const uploaded: CloudSnapshotEntry[] = [];
  const skipped: string[] = [];

  for (const candidate of candidates) {
    if (known.has(candidate.name)) {
      skipped.push(candidate.name);
      continue;
    }
    const file = await drive.upload(candidate.name, candidate.bytes, {
      mimeType: "application/octet-stream",
    });
    const entry: CloudSnapshotEntry = {
      name: candidate.name,
      fileId: file.id,
      uploadedAt: now,
      reason: candidate.reason,
      bytes: file.size ?? candidate.bytes.byteLength,
      sha256: candidate.sha256,
      counts: candidate.counts,
    };
    manifest = withEntry(manifest, entry);
    uploaded.push(entry);
  }

  const deleted: string[] = [];
  for (const entry of entriesBeyondRetention(manifest, now, limits)) {
    await drive.remove(entry.fileId);
    manifest = withoutEntry(manifest, entry.fileId);
    deleted.push(entry.name);
  }

  const body = new utf8Globals.TextEncoder().encode(
    serializeCloudManifest({ ...manifest, updatedAt: now }),
  );
  if (manifestFile) {
    await drive.replace(manifestFile.id, body);
  } else {
    await drive.upload(CLOUD_MANIFEST_NAME, body, { mimeType: "application/json" });
  }

  return { uploaded, deleted, skipped, manifest };
}

/**
 * Read the cloud manifest without changing anything (the Backups → Cloud list).
 * A missing or unreadable manifest is an empty list, never an error: the files themselves are
 * still downloadable, and the UI says so.
 */
export async function readCloudManifest(
  drive: DriveClient,
  libraryId: string,
  libraryName: string,
): Promise<CloudManifest> {
  const files = await drive.list();
  const manifestFile = findManifest(files);
  if (!manifestFile) return emptyManifest(libraryId, libraryName);
  const text = new utf8Globals.TextDecoder().decode(await drive.download(manifestFile.id));
  return parseCloudManifest(text) ?? emptyManifest(libraryId, libraryName);
}
