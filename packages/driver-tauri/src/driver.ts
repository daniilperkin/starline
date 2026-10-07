import type {
  IntegrityResult,
  OpenOptions,
  OpenResult,
  SnapshotInfo,
  SqlValue,
  StorageDriver,
  TxHandle,
  Unsubscribe,
} from "@starline/db";
import type { Transport } from "./transport";
import { decodeRows, encodeParams } from "./wire";

interface WireOpenResult {
  schemaVersion: number;
  applicationId: number;
  revision: number;
  lockedByOther: boolean;
}

interface WireSnapshot {
  path: string;
  byteSize: number;
  createdAt: number;
}

interface WireIntegrity {
  ok: boolean;
  messages: string[];
}

export interface TauriDriverOptions {
  /** Poll interval for `onExternalChange`, ms. Default 1500. */
  watchIntervalMs?: number;
}

/**
 * StorageDriver over any Transport (spec §2.3.2). Transactions: `BEGIN IMMEDIATE` is issued on
 * the storage process and every `tx.query` runs on that same process while the transaction is
 * open, so callback-style transactions work across the process boundary.
 */
export class TauriStorageDriver implements StorageDriver {
  private readonly transport: Transport;
  private readonly options: TauriDriverOptions;
  private readonly mtimeListeners = new Set<(info: { mtimeMs: number }) => void>();
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private lastMtime: number | null = null;
  private isOpen = false;

  constructor(transport: Transport, options: TauriDriverOptions = {}) {
    this.transport = transport;
    this.options = options;
  }

  async open(options: OpenOptions): Promise<OpenResult> {
    const result = await this.transport.request<WireOpenResult>("open", {
      path: options.path,
      create: options.create,
      readOnly: options.readOnly,
    });
    this.isOpen = true;
    return result;
  }

  async close(): Promise<void> {
    if (!this.isOpen) return;
    await this.transport.request("close");
    this.isOpen = false;
    this.stopWatching();
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<T[]> {
    const rows = await this.transport.request<Record<string, unknown>[]>("query", {
      sql,
      params: params ? encodeParams(params) : [],
    });
    return decodeRows<T>(rows);
  }

  async transaction<R>(fn: (tx: TxHandle) => Promise<R>): Promise<R> {
    await this.transport.request("begin");
    const tx: TxHandle = {
      query: async <T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]) => {
        const rows = await this.transport.request<Record<string, unknown>[]>("query", {
          sql,
          params: params ? encodeParams(params) : [],
        });
        return decodeRows<T>(rows);
      },
      execScript: async (sql: string) => {
        await this.transport.request("exec_script", { sql });
      },
    };
    try {
      const result = await fn(tx);
      await this.transport.request("commit");
      return result;
    } catch (error) {
      try {
        await this.transport.request("rollback");
      } catch {
        // Rollback may itself fail if the process died; surface the original error.
      }
      throw error;
    }
  }

  async snapshot(destPath: string): Promise<SnapshotInfo> {
    return this.transport.request<WireSnapshot>("snapshot", { dest: destPath });
  }

  async integrityCheck(): Promise<IntegrityResult> {
    return this.transport.request<WireIntegrity>("integrity_check");
  }

  onExternalChange(callback: (info: { mtimeMs: number }) => void): Unsubscribe {
    this.mtimeListeners.add(callback);
    this.startWatching();
    return () => {
      this.mtimeListeners.delete(callback);
      if (this.mtimeListeners.size === 0) this.stopWatching();
    };
  }

  private startWatching(): void {
    if (this.watchTimer) return;
    const interval = this.options.watchIntervalMs ?? 1500;
    this.watchTimer = setInterval(() => {
      void this.pollMtime();
    }, interval);
  }

  private stopWatching(): void {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  private async pollMtime(): Promise<void> {
    try {
      const { mtimeMs } = await this.transport.request<{ mtimeMs: number }>("mtime");
      if (this.lastMtime !== null && mtimeMs !== this.lastMtime) {
        for (const callback of [...this.mtimeListeners]) callback({ mtimeMs });
      }
      this.lastMtime = mtimeMs;
    } catch {
      // Process gone; nothing to poll.
    }
  }
}
