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
  DriveClient,
  readCloudManifest,
  type SnapshotCandidate,
} from "@starline/core";
import { create } from "zustand";
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
  /** True when this artifact was built with the cloud flavour and has a config. */
  available: boolean;
  enable: (library: CloudLibrary) => Promise<void>;
  disable: () => Promise<void>;
  refresh: (library: CloudLibrary) => Promise<void>;
  backUp: (library: CloudLibrary, candidates: SnapshotCandidate[]) => Promise<void>;
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
  available: cloudConfig !== null,

  async enable(library) {
    const config = cloudConfig;
    if (!config) {
      set({ status: "error", message: "cloud_unavailable" });
      return;
    }
    set({ status: "connecting", message: null });
    try {
      const session = await signInWithGoogle(config);
      const account = asCloudAccount(session);
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

  async backUp(library, candidates) {
    const account = get().account;
    if (!account) return;
    set({ status: "busy", message: null });
    try {
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
}));

/** Test seam: the key the preference is stored under. */
export const CLOUD_ENABLED_KEY = ENABLED_KEY;
