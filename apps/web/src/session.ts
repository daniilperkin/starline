import type { MigrationReport, OpenResult } from "@starline/db";
import type { TauriStorageDriver, WorkerTransport } from "@starline/driver-wasm";
import { create } from "zustand";

/** An open library: driver + transport + the open/migration facts from M0. */
export interface LibrarySession {
  driver: TauriStorageDriver;
  transport: WorkerTransport;
  name: string;
  info: OpenResult;
  report: MigrationReport;
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
