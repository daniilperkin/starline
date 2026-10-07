import type { SqlValue } from "@starline/core";

export type { SqlValue };

export interface OpenOptions {
  path: string | null;
  create: boolean;
  readOnly: boolean;
}

export interface OpenResult {
  schemaVersion: number;
  applicationId: number;
  revision: number;
  lockedByOther: boolean;
}

export interface SnapshotInfo {
  path: string;
  byteSize: number;
  createdAt: number;
}

export interface IntegrityResult {
  ok: boolean;
  messages: string[];
}

/** The statement surface available inside a transaction. */
export interface TxHandle {
  /** Run a parameterised statement; returns rows as plain objects. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Run a multi-statement SQL script (used by the migration runner; triggers contain semicolons). */
  execScript(sql: string): Promise<void>;
}

export type Unsubscribe = () => void;

/**
 * One interface, two drivers (spec §2.3.2): native rusqlite inside the Tauri shell,
 * sqlite-wasm (OPFS sahpool) in the web build. The same contract-test suite runs against both.
 */
export interface StorageDriver {
  open(opts: OpenOptions): Promise<OpenResult>;
  close(): Promise<void>;
  /** Run a parameterised statement; returns rows as plain objects. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  /** Run multiple statements atomically (BEGIN IMMEDIATE … COMMIT). Rolls back on throw. */
  transaction<R>(fn: (tx: TxHandle) => Promise<R>): Promise<R>;
  /** Consistent online snapshot (`VACUUM INTO` / SQLite backup API). */
  snapshot(destPath: string): Promise<SnapshotInfo>;
  integrityCheck(): Promise<IntegrityResult>;
  onExternalChange(cb: (info: { mtimeMs: number }) => void): Unsubscribe;
}
