/**
 * Getting bytes out of the app (spec §4.5.1 "Export… (native save dialog)"):
 * - Android: the app-scoped files folder (`deviceStorage.ts`), then the system share sheet
 *   (`@capacitor/share`) so the file can go to Drive, mail or a chat — the only way a file leaves
 *   a phone (decision 20; no SAF picker yet).
 * - Web: the File System Access API where the browser has it, otherwise a plain download.
 * Both plugins are imported lazily so neither lands in the app's main chunk.
 */

import { deviceFileUri, EXPORT_SUBDIR, writeDeviceFile } from "../deviceStorage";

export type SaveTarget = "documents" | "shared" | "picked" | "download";

export interface SaveResult {
  target: SaveTarget;
  /** Where the file went, for the confirmation line ("Documents/StarLine Exports/…"). */
  location: string;
  /** Set when the share sheet was opened with a file URI. */
  shared: boolean;
}

async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Opens the system share sheet for a file already written to the device folder. */
export async function shareFromDocuments(name: string): Promise<boolean> {
  try {
    const { Share } = await import("@capacitor/share");
    const uri = await deviceFileUri(EXPORT_SUBDIR, name);
    await Share.share({ title: name, url: uri, dialogTitle: name });
    return true;
  } catch {
    // A cancelled share sheet is not an error worth surfacing.
    return false;
  }
}

/**
 * Saves one export. Never throws for a cancelled picker — the caller shows "cancelled" instead of
 * an error, because a writer who closes the dialog did not hit a bug.
 */
export async function saveExportFile(
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<SaveResult> {
  if (await isNative()) {
    const location = await writeDeviceFile(EXPORT_SUBDIR, name, bytes);
    // Fire and forget: on Android the share sheet only resolves after the writer dismisses it,
    // and the confirmation line must not wait for that — the bytes are already on disk.
    void shareFromDocuments(name);
    return { target: "documents", location, shared: true };
  }

  const picker = (
    window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: mime, accept: { [mime]: [name.slice(name.lastIndexOf("."))] } }],
      });
      const writable = await handle.createWritable();
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await writable.write(copy);
      await writable.close();
      return { target: "picked", location: handle.name, shared: false };
    } catch {
      // Fall through to the download path: the picker throws on cancel and on a denied write.
    }
  }

  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser a moment to start the download before the URL disappears.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { target: "download", location: name, shared: false };
}
