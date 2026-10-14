/**
 * Opening an interchange file (`*.starline.json` or `*.starline.zip`) as a NEW library — the
 * "import a file" path on the start screen (spec §4.5.2). The whole project is written in one
 * transaction, so a failure half-way leaves an empty library rather than a half-imported one.
 */

import type { UUID } from "@starline/core";
import {
  type ImportReport,
  type ProjectExport,
  parseExportDocument,
  parseMarkdownFolder,
  writeProjectExport,
} from "@starline/core/interchange";
import { stripRootFolder, unzipFiles } from "@starline/core/zip";
import type { LibrarySession } from "../session";
import { listLibraries, openLibraryFully, replacePoolFile } from "../storage";

const decoder = new TextDecoder();

/** SQLite databases start with "SQLite format 3\0" — the `.starline` file's magic. */
export function looksLikeStarline(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const magic = "SQLite format 3";
  for (let index = 0; index < magic.length; index += 1) {
    if (bytes[index] !== magic.charCodeAt(index)) return false;
  }
  return true;
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Reads either interchange container into the same in-memory project shape. */
export function readInterchangeBytes(bytes: Uint8Array): ProjectExport {
  if (looksLikeZip(bytes)) {
    const { text, binary } = unzipFiles(bytes);
    const files = stripRootFolder(text);
    // Attachment entries stay bytes: `attachments/<sha256>.<ext>` rejoin their rows by hash.
    // Strip the same root folder the text files use, so both sides agree on the layout.
    const textPaths = Object.keys(text);
    const root = textPaths.length > 0 ? (textPaths[0] as string).split("/")[0] : undefined;
    const strippedBinary: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(binary)) {
      const relative =
        root !== undefined && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
      strippedBinary[relative] = data;
    }
    return parseMarkdownFolder(files, strippedBinary).data;
  }
  const text = decoder.decode(bytes);
  const parsed = parseExportDocument(text);
  if (!parsed.ok) {
    throw new Error(`not a StarLine export: ${parsed.issues.join("; ")}`);
  }
  return parsed.value.data;
}

/** A library file name that does not collide with one already on the device. */
export async function libraryNameFor(title: string): Promise<string> {
  const base = title.trim().length > 0 ? title.trim() : "Imported project";
  const safe = base.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
  const existing = new Set(await listLibraries());
  let candidate = `${safe}.starline`;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${safe} ${counter}.starline`;
    counter += 1;
  }
  return candidate;
}

export interface LibraryImportResult {
  session: LibrarySession;
  libraryName: string;
  report: ImportReport;
}

/**
 * Opens a `.starline` database file directly as a library (spec 4.5.2 "Open directly"). The
 * bytes go into the pool under a fresh name via `replacePoolFile`, then the ordinary open path
 * runs — migrations, health, crash marker — exactly as a native file open would.
 */
export async function openStarlineLibrary(
  bytes: Uint8Array,
  fileName: string,
): Promise<LibraryImportResult> {
  const libraryName = await libraryNameFor(fileName.replace(/\.starline$/i, ""));
  await replacePoolFile(`${libraryName}.starline`, bytes);
  const session = await openLibraryFully(libraryName, false);
  return {
    session,
    libraryName,
    report: {
      projectId: "direct" as UUID,
      title: libraryName,
      counts: {},
      remapped: 0,
      issues: [],
    },
  };
}

/**
 * Creates a library named after the imported project and writes the whole export into it.
 * Returns the opened session so the caller can switch straight to it.
 */
export async function importIntoNewLibrary(
  bytes: Uint8Array,
  fileName: string,
  onStage?: (stage: "reading" | "creating" | "writing") => void,
): Promise<LibraryImportResult> {
  onStage?.("reading");
  const data = readInterchangeBytes(bytes);
  const title = String(data.project.title ?? "").trim();
  const libraryName = await libraryNameFor(
    title.length > 0 ? title : fileName.replace(/\.(zip|json)$/i, ""),
  );

  onStage?.("creating");
  const session = await openLibraryFully(libraryName, true);
  onStage?.("writing");
  const report = await session.driver.transaction((tx) =>
    writeProjectExport(tx, data, { titleSuffix: " (imported)" }),
  );
  return { session, libraryName, report };
}
