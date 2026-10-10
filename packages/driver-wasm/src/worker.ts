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
  /**
   * Writes bytes as a pool file — the ONLY supported way to get a database INTO the pool. The
   * facade rewrites the header to force WAL off, so an imported file needs no `-wal`/`-shm`
   * sidecars to be readable.
   */
  importDb(
    name: string,
    data: Uint8Array | (() => Uint8Array | Promise<Uint8Array>),
  ): Promise<number>;
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
/** The install in flight, so concurrent ops share ONE install instead of racing (see ensureInit). */
let poolInstall: Promise<SahPool> | null = null;
let db: PoolDb | null = null;
let readOnly = false;
let inTx = false;
/** Second connection, used only to read a snapshot (or any other pool file) while the live
 * database stays open. Guarded by `PRAGMA query_only`, so it cannot write even by accident. */
let roDb: PoolDb | null = null;

async function ensureInit(): Promise<SahPool> {
  if (!sqlite3) {
    sqlite3 = (await sqlite3InitModule()) as unknown as Sqlite3Api;
  }
  if (!pool) {
    // SINGLE-FLIGHT. The app fires several worker ops at once on boot (list libraries, pool
    // stats) and every one of them lands here. Two installs racing inside one worker is exactly
    // what produces "Access Handles cannot be created if there is another open Access Handle":
    // the second install fights the first one's handles, and sqlite-wasm's recovery cannot fix
    // it — removeVfs() fails the same way — leaving a pool that never finishes installing, so
    // every later op (including an import) waits forever instead of failing.
    poolInstall ??= installPool().catch((cause: unknown) => {
      poolInstall = null; // a rejected install must stay retryable
      throw cause;
    });
    pool = await poolInstall;
  }
  return pool;
}

async function installPool(): Promise<SahPool> {
  // The sahpool VFS owns a set of pre-allocated file slots. The initial capacity stays small
  // (16) on purpose: sqlite-wasm re-runs addCapacity() on installs over an existing pool
  // directory, so a big initial number can balloon the pool; growth is on demand instead
  // (ensurePoolHeadroom). Also: sqlite-wasm CACHES a failed install per worker, so a retry
  // needs forceReinitIfPreviouslyFailed.
  const startedAt = Date.now();
  for (;;) {
    try {
      return await (sqlite3 as Sqlite3Api).installOpfsSAHPoolVfs({
        name: "starline-sahpool",
        initialCapacity: 16,
        forceReinitIfPreviouslyFailed: true,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // A previous page's worker may still be releasing its access handles (that is
      // asynchronous and takes a few seconds after a reload); retrying is the documented
      // workaround for exactly this environment.
      const transient = /NoModificationAllowedError|Access Handles cannot be created/.test(message);
      if (!transient || Date.now() - startedAt > 15_000) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * The pool keys its file map by the PERCENT-ENCODED name (`/My%20Novel.starline`) — that is what
 * `getFileNames()` returns — while the app's session name is whatever the writer typed
 * ("My Novel") or whatever the start screen listed (encoded). Every op that names a pool file
 * has to accept both forms and agree on one canonical name, or an unlink/import pair silently
 * creates a duplicate file and the app reopens whichever one the VFS resolves first.
 */
function resolvePoolName(sahPool: SahPool, raw: string): string | null {
  const bare = raw.replace(/^\//, "");
  for (const entry of sahPool.getFileNames()) {
    if (entry === raw || entry === `/${bare}`) return entry;
    let decoded = entry;
    try {
      decoded = decodeURIComponent(entry);
    } catch {
      // A name that is not valid percent-encoding is compared as-is.
    }
    if (decoded === bare || decoded === `/${bare}`) return entry;
  }
  return null;
}

/** The name a NEW file should get, in the pool's canonical form. */
function canonicalPoolName(raw: string): string {
  return `/${encodeURIComponent(raw.replace(/^\//, ""))}`;
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
      // Opening needs FOUR slots, not one: the database file, its rollback journal (created on
      // the first write), plus the `-wal` and `-shm` sidecars. Reserving two was one short —
      // the journal creation failed with "SAH pool is full. Cannot create file /X.starline-journal"
      // and the library could no longer be opened at all.
      await ensurePoolHeadroom(4);
      const path = String(req.path);
      const create = Boolean(req.create);
      const ro = Boolean(req.readOnly);
      const canonical = resolvePoolName(sahPool, path);
      const existed = canonical !== null;
      if (!existed && !create) throw new Error(`file not found: ${path}`);
      // Open (and, on create, store) under the pool's canonical name so a later list/open by
      // either form finds the same file.
      db = new sahPool.OpfsSAHPoolDb(canonical ?? canonicalPoolName(path));
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
      // A snapshot needs TWO slots: the materialised file itself and the rollback journal
      // SQLite creates while filling it. One short and the journal fails mid-snapshot, which is
      // what poisoned the pool for every later write in the session.
      await ensurePoolHeadroom(2);
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
      const name =
        resolvePoolName(sahPool, String(req.path)) ?? canonicalPoolName(String(req.path));
      return { bytes: sahPool.exportFile(name) };
    }
    case "import_file": {
      // Slice 11/12: bytes INTO the pool. `importDb` is the only ingress the sahpool facade
      // offers (the pool stores files under opaque random slot names, so writing them from the
      // page is impossible) — restore and "open an external .starline" both land here.
      const sahPool = await ensureInit();
      const name =
        resolvePoolName(sahPool, String(req.name)) ?? canonicalPoolName(String(req.name));
      const bytes = req.bytes as Uint8Array;
      if (!(bytes instanceof Uint8Array)) throw new Error("import_file needs bytes");
      // An imported database occupies its own slot plus, while SQLite opens it, a journal.
      await ensurePoolHeadroom(4);
      const written = await sahPool.importDb(name, bytes);
      return { name, byteSize: written };
    }
    case "replace_file": {
      // Restore (slice 11) and "open an external .starline" (slice 12) both replace a file's
      // bytes. The pool keys its map by the PERCENT-ENCODED name (`/My%20Novel.starline`) while
      // the app's session name is the decoded one, so an unlink/import with the raw name misses
      // the existing entry and silently creates a SECOND file with the same logical name — the
      // app then reopens whichever one the VFS resolves first. Resolve the canonical name from
      // the pool itself before touching anything.
      const sahPool = await ensureInit();
      const canonical =
        resolvePoolName(sahPool, String(req.name)) ?? canonicalPoolName(String(req.name));
      const bytes = req.bytes as Uint8Array;
      if (!(bytes instanceof Uint8Array)) throw new Error("replace_file needs bytes");
      // An imported database needs its own slot plus a journal while SQLite opens it.
      await ensurePoolHeadroom(4);
      if (sahPool.getFileNames().includes(canonical)) sahPool.unlink(canonical);
      const written = await sahPool.importDb(canonical, bytes);
      return { name: canonical, byteSize: written };
    }
    case "open_ro": {
      if (roDb) throw new Error("read-only connection already open");
      const sahPool = await ensureInit();
      await ensurePoolHeadroom(4);
      roDb = new sahPool.OpfsSAHPoolDb(String(req.path));
      roDb.exec("PRAGMA query_only=ON;");
      return { path: String(req.path) };
    }
    case "ro_query": {
      if (!roDb) throw new Error("no read-only connection open");
      return roDb.exec({
        sql: String(req.sql),
        bind: (req.params as unknown[]) ?? [],
        rowMode: "object",
        returnValue: "resultRows",
      });
    }
    case "ro_close": {
      if (roDb) {
        roDb.close();
        roDb = null;
      }
      return null;
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
      // The pool's file map is keyed by ABSOLUTE, percent-encoded names; a name that does not
      // match exactly returns false and silently leaks the slot forever, so resolve first.
      const name =
        resolvePoolName(sahPool, String(req.path)) ?? canonicalPoolName(String(req.path));
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
      if (roDb) {
        roDb.close();
        roDb = null;
      }
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
