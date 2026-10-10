/**
 * The one place that knows where bytes go on the phone.
 *
 * Everything writes to the **app-scoped** external files directory —
 * `Android/data/app.starline/files/<folder>` — which needs no permission, is reachable over USB and
 * a file manager, and is what decision 20 means by "app-scoped Documents folder". The shared
 * `/sdcard/Documents` is NOT writable on Android 11+ without `MANAGE_EXTERNAL_STORAGE`; attempting
 * it fails with `EACCES`, which is how the slice-12 on-device export caught the snapshot mirror
 * doing the same thing (see `snapshots.ts`).
 *
 * Both exports and the snapshot mirror go through here so a device path decision is made once.
 */

/** Exports land here (inside the app's files directory). */
export const EXPORT_SUBDIR = "StarLine Exports";
/** The snapshot mirror's folder, see `snapshots.ts`. */
export const MIRROR_SUBDIR = "StarLine Backups";

function base64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: a multi-megabyte string built in one call overflows the argument list on some engines.
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function filesystem(): Promise<typeof import("@capacitor/filesystem")> {
  return import("@capacitor/filesystem");
}

/** Creates the folder if it is missing; returns nothing — the plugins create parents on write. */
export async function ensureDeviceFolder(folder: string): Promise<void> {
  const { Directory, Filesystem } = await filesystem();
  await Filesystem.mkdir({
    path: folder,
    directory: Directory.External,
    recursive: true,
  }).catch(() => undefined);
}

/** Writes bytes into the app-scoped folder; returns the path relative to that folder. */
export async function writeDeviceFile(
  folder: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const { Directory, Filesystem } = await filesystem();
  const path = folder.length > 0 ? `${folder}/${name}` : name;
  await Filesystem.writeFile({
    path,
    data: base64(bytes),
    directory: Directory.External,
    recursive: true,
  });
  return path;
}

/** The `content://` URI of a file already written, for the share sheet. */
export async function deviceFileUri(folder: string, name: string): Promise<string> {
  const { Directory, Filesystem } = await filesystem();
  const path = folder.length > 0 ? `${folder}/${name}` : name;
  const uri = await Filesystem.getUri({ path, directory: Directory.External });
  return uri.uri;
}
