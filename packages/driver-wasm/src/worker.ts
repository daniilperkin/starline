/// <reference lib="webworker" />
// Storage worker: sqlite-wasm over the OPFS sahpool VFS, speaking the same op protocol as
// crates/starline-storage-cli so the shared contract suite covers both drivers identically.
// No COOP/COEP headers are required (sahpool VFS, spec §5.4.3).

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

interface Sqlite3Api {
  installOpfsSAHPoolVfs(options: {
    name: string;
    initialCapacity?: number;
    forceReinitIfPreviouslyFailed?: boolean;
  }): Promise<SahPool>;
}

interface SahPool {
  OpfsSAHPoolDb: new (filename: string) => PoolDb;
  getFileNames(): string[];
  /** Deletes a pool file. Takes the ABSOLUTE name (`/lib.starline`) — an exact map lookup. */
  unlink(filename: string): boolean;
  exportFile(filename: string): Uint8Array;
  getCapacity(): number;
  getFileCount(): number;
  /** Grows the pool until it holds at least `min` slots. */
  reserveMinimumCapacity(min: number): Promise<number>;
}

interface ExecOptions {
  sql: string;
  bind?: unknown[];
  rowMode?: "object";
  returnValue?: "resultRows";
}

interface PoolDb {
  exec(sql: string): unknown;
  exec(options: ExecOptions): Record<string, unknown>[];
  changes(): number;
  close(): void;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let sqlite3: Sqlite3Api | null = null;
let pool: SahPool | null = null;
let db: PoolDb | null = null;
let readOnly = false;
let inTx = false;

async function ensureInit(): Promise<SahPool> {
  if (!sqlite3) {
    sqlite3 = (await sqlite3InitModule()) as unknown as Sqlite3Api;
  }
  if (!pool) {
    // The sahpool VFS owns a set of pre-allocated file slots. The initial capacity stays small
    // (16) on purpose: sqlite-wasm re-runs addCapacity() on installs over an existing pool
    // directory, so a big initial number can balloon the pool; growth is on demand instead
    // (ensurePoolHeadroom). Also: sqlite-wasm CACHES a failed install per worker, so a retry
    // needs forceReinitIfPreviouslyFailed.
    const startedAt = Date.now();
    for (;;) {
      try {
        pool = await sqlite3.installOpfsSAHPoolVfs({
          name: "starline-sahpool",
          initialCapacity: 16,
          forceReinitIfPreviouslyFailed: true,
        });
        break;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        // The previous page's worker may still be releasing its access handles (that is
        // asynchronous and takes a few seconds after a reload); retrying is the documented
        // workaround for exactly this environment.
        const transient = /NoModificationAllowedError|Access Handles cannot be created/.test(
          message,
        );
        if (!transient || Date.now() - startedAt > 15_000) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  return pool;
}

function requireDb(): PoolDb {
  if (!db) throw new Error("not open");
  return db;
}

/**
 * The sahpool has a FIXED number of file slots; a database, its rollback journal and snapshot
 * temps each occupy one, and a full pool surfaces as "SAH pool is full" the moment SQLite
 * tries to create the journal — i.e. a library that can no longer be opened. Make sure a few
 * slots are free before an operation that needs to create files.
 */
async function ensurePoolHeadroom(needed = 4): Promise<void> {
  const sahPool = await ensureInit();
  await sahPool.reserveMinimumCapacity(sahPool.getFileCount() + needed);
}

function queryRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  return requireDb().exec({ sql, bind: params, rowMode: "object", returnValue: "resultRows" });
}

function firstValue(sql: string, params: unknown[] = []): unknown {
  const row = queryRows(sql, params)[0];
  return row ? Object.values(row)[0] : undefined;
}

function tableExists(name: string): boolean {
  const count = firstValue(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?1",
    [name],
  );
  return Number(count) > 0;
}

async function handle(op: string, req: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case "ping":
      return { pong: true };
    case "open": {
      if (db) throw new Error("already open");
      const sahPool = await ensureInit();
      // Opening creates the rollback journal immediately, and creating a library adds a file:
      // make sure the pool has slots for both before SQLite touches the filesystem.
      await ensurePoolHeadroom(2);
      const path = String(req.path);
      const create = Boolean(req.create);
      const ro = Boolean(req.readOnly);
      // Pool names are stored with a leading slash; normalize before comparing.
      const lookupName = path.startsWith("/") ? path : `/${path}`;
      const existed = sahPool.getFileNames().includes(lookupName);
      if (!existed && !create) throw new Error(`file not found: ${path}`);
      db = new sahPool.OpfsSAHPoolDb(path);
      readOnly = ro;
      db.exec("PRAGMA foreign_keys=ON;");
      const applicationId = Number(firstValue("PRAGMA application_id")) || 0;
      const schemaVersion = Number(firstValue("PRAGMA user_version")) || 0;
      if (applicationId !== 0 && applicationId !== 0x5354524c) {
        db.close();
        db = null;
        throw new Error(`not a StarLine file (application_id = ${applicationId})`);
      }
      if (applicationId === 0 && !ro && (!existed || schemaVersion === 0)) {
        db.exec("PRAGMA application_id = 1398035020;");
      }
      const revision = tableExists("meta")
        ? Number(firstValue("SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'revision'")) || 0
        : 0;
      return {
        schemaVersion,
        applicationId: applicationId === 0 ? 0x5354524c : applicationId,
        revision,
        lockedByOther: false,
      };
    }
    case "close": {
      if (!db) throw new Error("close: not open");
      db.close();
      db = null;
      return null;
    }
    case "query":
      return queryRows(String(req.sql), (req.params as unknown[]) ?? []);
    case "exec": {
      if (readOnly) throw new Error("read-only connection");
      const handleDb = requireDb();
      handleDb.exec({ sql: String(req.sql), bind: (req.params as unknown[]) ?? [] });
      return { changed: handleDb.changes() };
    }
    case "exec_script": {
      if (readOnly) throw new Error("read-only connection");
      requireDb().exec(String(req.sql));
      return null;
    }
    case "begin": {
      if (readOnly) throw new Error("read-only connection");
      if (inTx) throw new Error("already in a transaction");
      requireDb().exec("BEGIN IMMEDIATE;");
      inTx = true;
      return null;
    }
    case "commit": {
      if (!inTx) throw new Error("no transaction in progress");
      requireDb().exec("COMMIT;");
      inTx = false;
      return null;
    }
    case "rollback": {
      if (!inTx) throw new Error("no transaction in progress");
      requireDb().exec("ROLLBACK;");
      inTx = false;
      return null;
    }
    case "snapshot": {
      const dest = String(req.dest);
      // A snapshot materialises a whole new file in the pool — one free slot required.
      await ensurePoolHeadroom(1);
      requireDb().exec(`VACUUM INTO '${dest.replace(/'/g, "''")}';`);
      let byteSize = 0;
      try {
        const exportName = dest.startsWith("/") ? dest : `/${dest}`;
        // exportFile() returns the file's bytes (Uint8Array), not a File object.
        byteSize = (pool as SahPool).exportFile(exportName).byteLength;
      } catch {
        // exportFile may be unavailable in older builds; the snapshot itself is what matters.
      }
      return { path: dest, byteSize, createdAt: Date.now() };
    }
    case "export_file": {
      // The web snapshot flow copies pool files into the real OPFS (apps/web/src/snapshots.ts):
      // the main thread needs the raw bytes, so hand them back over postMessage.
      const sahPool = await ensureInit();
      const raw = String(req.path);
      const name = raw.startsWith("/") ? raw : `/${raw}`;
      return { bytes: sahPool.exportFile(name) };
    }
    case "integrity_check": {
      const rows = queryRows("PRAGMA integrity_check");
      const messages = rows.map((row) => String(Object.values(row)[0]));
      return { ok: messages.length === 1 && messages[0] === "ok", messages };
    }
    case "list": {
      const sahPool = await ensureInit();
      return { files: sahPool.getFileNames() };
    }
    case "mtime":
      return { mtimeMs: 0 };
    case "unlink": {
      const sahPool = await ensureInit();
      // The pool's file map is keyed by ABSOLUTE names ("/snap-tmp-x.starline", as xOpen
      // normalizes them); a relative name is an exact-lookup miss that returns false and
      // silently leaks the slot forever.
      const raw = String(req.path);
      const name = raw.startsWith("/") ? raw : `/${raw}`;
      return { removed: sahPool.unlink(name) };
    }
    case "pool_stats": {
      const sahPool = await ensureInit();
      return {
        capacity: sahPool.getCapacity(),
        fileCount: sahPool.getFileCount(),
        files: sahPool.getFileNames(),
      };
    }
    case "shutdown": {
      if (db) {
        db.close();
        db = null;
      }
      return null;
    }
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

ctx.onmessage = async (event: MessageEvent) => {
  const req = event.data as Record<string, unknown>;
  const id = req.id as number;
  const op = String(req.op);
  try {
    const result = await handle(op, req);
    ctx.postMessage({ id, ok: true, result });
  } catch (error) {
    ctx.postMessage({
      id,
      ok: false,
      error: { message: error instanceof Error ? `${op}: ${error.message}` : String(error) },
    });
  }
};
