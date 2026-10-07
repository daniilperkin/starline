/// <reference lib="webworker" />
// Storage worker: sqlite-wasm over the OPFS sahpool VFS, speaking the same op protocol as
// crates/starline-storage-cli so the shared contract suite covers both drivers identically.
// No COOP/COEP headers are required (sahpool VFS, spec §5.4.3).

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

interface Sqlite3Api {
  installOpfsSAHPoolVfs(options: { name: string; initialCapacity?: number }): Promise<SahPool>;
}

interface SahPool {
  OpfsSAHPoolDb: new (filename: string) => PoolDb;
  getFileNames(): string[];
  unlink(filename: string): boolean;
  exportFile(filename: string): Uint8Array;
}

interface ExecOptions {
  sql: string;
  bind?: unknown[];
  rowMode?: "object";
  returnValue?: "resultRows";
}

interface PoolDb {
  exec(sql: string): unknown;
  exec(options: ExecOptions): unknown[];
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
    // The sahpool VFS pre-allocates fixed slots (default capacity is only 6 files); snapshots
    // and imports share the pool, and exhausting it surfaces as SQLITE_CANTOPEN on open.
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: "starline-sahpool", initialCapacity: 64 });
  }
  return pool;
}

function requireDb(): PoolDb {
  if (!db) throw new Error("not open");
  return db;
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
      // Pool names are stored with a leading slash; deletePath() is an exact map lookup.
      const raw = String(req.path);
      const name = raw.startsWith("/") ? raw : `/${raw}`;
      return { removed: sahPool.unlink(name) };
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
