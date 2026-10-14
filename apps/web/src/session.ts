import type { MigrationReport, OpenResult } from "@starline/db";
import type { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import { create } from "zustand";
import type { SessionHealth } from "./health";

/** An open library: driver + transport + the open/migration facts from M0. */
export interface LibrarySession {
  driver: TauriStorageDriver;
  transport: WorkerTransport;
  name: string;
  info: OpenResult;
  report: MigrationReport;
  /** Crash/integrity findings from the open sequence (spec §2.3.3). */
  health: SessionHealth;
  /** A file written by a newer StarLine opens read-only (spec §4.5.4 downgrade policy). */
  readOnly?: boolean;
}

interface SessionState {
  session: LibrarySession | null;
  setSession: (session: LibrarySession | null) => void;
}

/** Ephemeral UI state only — the database stays the source of truth (spec §2.3.1). */
export const useSessionStore = create<SessionState>()((set) => ({
  session: null,
  setSession: (session) => set({ session }),
}));
