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
  const input: Record<string, Uint8Array> = {};
  for (const [path, text] of Object.entries(files)) {
    input[path] = strToU8(text);
  }
  // ZIP cannot store a timestamp before 1980, and the default (now) would make two identical
  // exports differ: pin the archive epoch so the round-trip gate can compare bytes.
  return zipSync(input, { level: 6, mtime: ZIP_EPOCH });
}

export function unzipTextFiles(bytes: Uint8Array): FileMap {
  const unzipped = unzipSync(bytes);
  const files: FileMap = {};
  for (const [path, data] of Object.entries(unzipped)) {
    // A directory entry carries no data; skip it rather than emitting an empty file.
    if (path.endsWith("/")) continue;
    files[path] = strFromU8(data);
  }
  return files;
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
