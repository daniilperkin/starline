import { useCallback, useEffect, useRef, useState } from "react";
import { importIntoNewLibrary } from "./export/importLibrary";
import type { LibrarySession } from "./session";
import { cleanupTempFiles, listLibraries, openLibraryFully } from "./storage";
import { ThemeButton } from "./ThemeButton";

export function StartScreen({ onOpen }: { onOpen: (session: LibrarySession) => void }) {
  const [libraries, setLibraries] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      // Sweep orphaned snapshot temp files first — a crash mid-snapshot can leave one behind
      // and it must not read as a library (spec §4.5.3).
      await cleanupTempFiles().catch(() => 0);
      setLibraries(await listLibraries());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (name: string, create: boolean) => {
      setBusy(true);
      setError(null);
      try {
        // Crash marker + integrity check + 30-day trash purge (spec §2.3.3, §5.3), shared with
        // the restore path so both open a library the same way. The health snapshot is read
        // BEFORE the marker is overwritten so the previous session's unclean exit is visible.
        const opened = await openLibraryFully(name, create);
        onOpen(opened);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onOpen],
  );

  const createName = newName.trim().replace(/\.starline$/i, "");

  /** Opens a `*.starline.json` / `*.starline.zip` as a new library and switches to it. */
  const importFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        setImporting("Reading the file…");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await importIntoNewLibrary(bytes, file.name, (stage) => {
          setImporting(
            stage === "reading"
              ? "Reading the file…"
              : stage === "creating"
                ? "Creating the library…"
                : "Writing the project…",
          );
        });
        const rows = Object.values(result.report.counts).reduce((sum, count) => sum + count, 0);
        setNotice(`${result.libraryName}: ${rows} rows imported`);
        onOpen(result.session);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
        setImporting(null);
      }
    },
    [onOpen],
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-5 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="sl-wordmark text-4xl font-semibold tracking-tight">✦ StarLine</h1>
          <p className="mt-2 text-sm text-muted">Your story, among the stars.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="sl-chip">✦ offline</span>
            <span className="sl-chip">on your device</span>
            <span className="sl-chip">installable</span>
          </div>
        </div>
        <ThemeButton />
      </header>

      <section className="sl-card p-5">
        <h2 className="text-sm font-medium text-muted">Create a library</h2>
        <div className="mt-3 flex gap-2">
          <input
            className="sl-input flex-1"
            placeholder="My Novel"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && createName && !busy) void open(createName, true);
            }}
          />
          <button
            type="button"
            className="sl-btn sl-btn-primary"
            disabled={busy || createName.length === 0}
            onClick={() => void open(createName, true)}
          >
            Create
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Reusing an existing name opens that library instead of overwriting it.
        </p>
      </section>

      <section className="sl-card p-5">
        <h2 className="text-sm font-medium text-muted">Import a project</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="sl-btn"
            data-testid="sl-import-file"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {importing ?? "Choose a file…"}
          </button>
          <span className="text-xs text-muted">.starline.json or .starline.zip</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          data-testid="sl-import-input"
          accept=".json,.zip,application/json,application/zip"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
        {notice ? (
          <p className="sl-notice mt-3" data-testid="sl-import-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>

      <section className="sl-card p-5">
        <h2 className="text-sm font-medium text-muted">Your libraries</h2>
        {libraries.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No libraries yet — create one above.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {libraries.map((library) => {
              const displayName = decodeURIComponent(library).replace(/\.starline$/, "");
              return (
                <li
                  key={library}
                  className="flex items-center justify-between rounded-2xl border border-line px-3 py-2"
                >
                  <span className="text-sm">
                    <span aria-hidden="true" className="mr-1 text-accent">
                      ✦
                    </span>
                    {displayName}
                  </span>
                  <button
                    type="button"
                    className="sl-btn"
                    disabled={busy}
                    onClick={() => void open(library.replace(/\.starline$/, ""), false)}
                  >
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error ? (
        <p className="rounded-2xl border border-danger px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}

      <footer className="text-center text-xs text-muted">
        Install on your phone: open in Chrome → menu → “Add to Home screen”.
      </footer>
    </div>
  );
}
