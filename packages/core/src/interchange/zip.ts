/**
 * Zip/unzip for the folder and DOCX formats, on `fflate` (decision 20). Kept in its own module
 * and NOT re-exported from the interchange barrel: only the export screen (a lazy route) and the
 * export worker import it, so `fflate` never lands in the app's main chunk.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { FileMap } from "./markdown";

/** 1980-01-01T00:00:00Z — the earliest timestamp a ZIP entry can carry. */
const ZIP_EPOCH = 315_532_800_000;

/** Deterministic archive: same files, same bytes (the round-trip gate compares archives). */
export function zipTextFiles(files: FileMap): Uint8Array {
  return zipFiles(files, {});
}

/**
 * Text files plus binary entries (attachment bytes). Both go through the same deterministic
 * settings, so `export → import → export` still compares byte for byte.
 */
export function zipFiles(files: FileMap, binary: Record<string, Uint8Array> = {}): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) {
    input[path] = strToU8(text);
  }
  for (const [path, bytes] of Object.entries(binary)) {
    input[path] = bytes;
  }
  // ZIP cannot store a timestamp before 1980, and the default (now) would make two identical
  // exports differ: pin the archive epoch so the round-trip gate can compare bytes.
  return zipSync(input, { level: 6, mtime: ZIP_EPOCH });
}

export function unzipTextFiles(bytes: Uint8Array): FileMap {
  return unzipFiles(bytes).text;
}

/**
 * Splits archive entries: everything under `attachments/` stays bytes (decoding an image as
 * UTF-8 would corrupt it), everything else is decoded as text.
 */
export function unzipFiles(bytes: Uint8Array): {
  text: FileMap;
  binary: Record<string, Uint8Array>;
} {
  const unzipped = unzipSync(bytes);
  const text: FileMap = {};
  const binary: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(unzipped)) {
    // A directory entry carries no data; skip it rather than emitting an empty file.
    if (path.endsWith("/")) continue;
    if (path.includes("attachments/")) binary[path] = data;
    else text[path] = strFromU8(data);
  }
  return { text, binary };
}

/** The folder inside the archive carries a top-level directory named after the project. */
export function stripRootFolder(files: FileMap): FileMap {
  const paths = Object.keys(files);
  if (paths.length === 0) return files;
  const first = paths[0] as string;
  const root = first.split("/")[0];
  if (root === undefined || !paths.every((path) => path.startsWith(`${root}/`))) return files;
  const stripped: FileMap = {};
  for (const [path, text] of Object.entries(files)) {
    stripped[path.slice(root.length + 1)] = text;
  }
  return stripped;
}
