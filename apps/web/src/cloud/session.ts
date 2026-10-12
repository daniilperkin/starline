/**
 * Cloud backup session state (slice 15, decisions 18/23).
 *
 * One store owns the answer to "is cloud backup on, for whom, and what happened last time?" —
 * the Settings panel and the Backups → Cloud tab both read it, so they can never disagree.
 *
 * Everything network-shaped stays behind this module: the UI only calls enable/disable/refresh/
 * backUp and renders `status`. The Drive client is built here from the account's token function,
 * and the manifest is the single source for what the cloud currently holds.
 *
 * The preference lives in localStorage (device state, like the writing-mode typography) — never in
 * the library file, because "this phone backs up to that Google account" is not part of the novel.
 */

import {
  backupSnapshots,
  type CloudManifest,
  type CloudSnapshotEntry,
  DriveClient,
  readCloudManifest,
  type SnapshotCandidate,
  sha256Hex,
  withoutEntry,
} from "@starline/core";
import { create } from "zustand";
import {
  listSnapshots,
  readSnapshotBytes,
  setSnapshotTakenListener,
  writeSnapshotBytes,
} from "../snapshots";
import { isNativeShell, signInNative } from "./auth-native";
import { asCloudAccount, signInWithGoogle } from "./auth-web";
import { cloudConfig } from "./config";
import type { CloudAccount } from "./types";

const ENABLED_KEY = "starline.cloud.enabled";

export type CloudStatus = "off" | "connecting" | "ready" | "busy" | "error";

export interface CloudLibrary {
  id: string;
  name: string;
}

interface CloudStore {
  enabled: boolean;
  email: string | null;
  subject: string | null;
  status: CloudStatus;
  message: string | null;
  manifest: CloudManifest | null;
  account: CloudAccount | null;
  /** The library the last operation ran for — the snapshot hook has only a name to go on. */
  lastLibrary: CloudLibrary | null;
  /** True when this artifact was built with the cloud flavour and has a config. */
  available: boolean;
  enable: (library: CloudLibrary) => Promise<void>;
  disable: () => Promise<void>;
  refresh: (library: CloudLibrary) => Promise<void>;
  backUp: (library: CloudLibrary) => Promise<void>;
  downloadToLocal: (library: CloudLibrary, entry: CloudSnapshotEntry) => Promise<void>;
  removeFromCloud: (library: CloudLibrary, entry: CloudSnapshotEntry) => Promise<void>;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "on";
  } catch {
    return false;
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ENABLED_KEY, "on");
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    // storage denied: the session still works, it just forgets the choice
  }
}

function clientFor(account: CloudAccount): DriveClient {
  return new DriveClient({ accessToken: () => account.accessToken() });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useCloudStore = create<CloudStore>((set, get) => ({
  enabled: readEnabled(),
  email: null,
  subject: null,
  status: "off",
  message: null,
  manifest: null,
  account: null,
  lastLibrary: null,
  available: cloudConfig !== null,

  async enable(library) {
    const config = cloudConfig;
    if (!config) {
      set({ status: "error", message: "cloud_unavailable" });
      return;
    }
    set({ status: "connecting", message: null });
    try {
      // Android runs inside a WebView, where Google blocks Identity Services — the native plugin
      // signs in there instead. Same account shape, same Drive layer behind it.
      const native = await isNativeShell();
      const account = native
        ? await signInNative(config)
        : asCloudAccount(await signInWithGoogle(config));
      const manifest = await readCloudManifest(clientFor(account), library.id, library.name);
      writeEnabled(true);
      set({
        enabled: true,
        account,
        email: account.email,
        subject: account.subject,
        manifest,
        status: "ready",
        message: null,
      });
    } catch (error) {
      set({ status: "error", message: describe(error) });
    }
  },

  async disable() {
    writeEnabled(false);
    set({
      enabled: false,
      account: null,
      email: null,
      subject: null,
      manifest: null,
      status: "off",
      message: null,
    });
  },

  async refresh(library) {
    const account = get().account;
    if (!account) return;
    set({ status: "busy", message: null });
    try {
      const manifest = await readCloudManifest(clientFor(account), library.id, library.name);
      set({ manifest, status: "ready" });
    } catch (error) {
      set({ status: "error", message: describe(error) });
    }
  },

  async backUp(library) {
    const account = get().account;
    if (!account) return;
    set({ status: "busy", message: null, lastLibrary: library });
    try {
      const candidates = await candidatesFor(library.name);
      const result = await backupSnapshots(
        {
          drive: clientFor(account),
          libraryId: library.id,
          libraryName: library.name,
          now: Date.now(),
        },
        candidates,
      );
      set({ manifest: result.manifest, status: "ready" });
    } catch (error) {
      set({ status: "error", message: describe(error) });
    }
  },
  async downloadToLocal(library, entry) {
    const account = get().account;
    if (!account) return;
    set({ status: "busy", message: null, lastLibrary: library });
    try {
      // A downloaded snapshot keeps its original file name, so the local machinery parses it and
      // the writer can preview and restore it exactly like a locally taken one.
      const bytes = await clientFor(account).download(entry.fileId);
      await writeSnapshotBytes(entry.name, bytes);
      set({ status: "ready" });
    } catch (error) {
      set({ status: "error", message: describe(error) });
    }
  },

  async removeFromCloud(library, entry) {
    const account = get().account;
    if (!account) return;
    set({ status: "busy", message: null, lastLibrary: library });
    try {
      await clientFor(account).remove(entry.fileId);
      const manifest = get().manifest;
      set({
        manifest: manifest ? withoutEntry(manifest, entry.fileId) : null,
        status: "ready",
      });
    } catch (error) {
      set({ status: "error", message: describe(error) });
    }
  },
}));

/**
 * Every local snapshot that is not yet in the cloud manifest, with its bytes and hash.
 * Snapshots are immutable, so "already listed" means "identical" and the upload can skip it.
 */
async function candidatesFor(libraryName: string): Promise<SnapshotCandidate[]> {
  const entries = await listSnapshots(libraryName);
  const candidates: SnapshotCandidate[] = [];
  for (const entry of entries) {
    const bytes = await readSnapshotBytes(entry.name);
    candidates.push({
      name: entry.name,
      bytes,
      reason: entry.reason,
      createdAt: entry.createdAt,
      sha256: await sha256Hex(bytes),
    });
  }
  return candidates;
}

/**
 * A snapshot was just written. Mirror it to Drive if — and only if — the writer turned cloud
 * backup on; otherwise this is a no-op and the app makes no network request.
 */
export function registerCloudSnapshotHook(): void {
  setSnapshotTakenListener((libraryName) => {
    const state = useCloudStore.getState();
    if (!state.enabled || !state.account) return;
    // Never guess the library id: the manifest's libraryId is the folder key, and a name is not a
    // stable identity. Until an operation has seen the real project row, the hook stays quiet.
    const library = state.lastLibrary;
    if (!library || library.name !== libraryName) return;
    void state.backUp(library);
  });
}

/** Test seam: the key the preference is stored under. */
export const CLOUD_ENABLED_KEY = ENABLED_KEY;
