import { type ImportIssue, messages } from "@starline/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  importIntoNewLibrary,
  looksLikeStarline,
  openStarlineLibrary,
} from "./export/importLibrary";
import type { LibrarySession } from "./session";
import { cleanupTempFiles, listLibraries, openLibraryFully } from "./storage";
import { ThemeButton } from "./ThemeButton";
import { useTourStore } from "./tour/tour-store";

export function StartScreen({ onOpen }: { onOpen: (session: LibrarySession) => void }) {
  const startTour = useTourStore((state) => state.start);
  const dismissOffer = useTourStore((state) => state.dismissOffer);
  const offered = useTourStore((state) => state.offered);
  const [libraries, setLibraries] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
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
        setImporting(messages.app.readingFile);
        const bytes = new Uint8Array(await file.arrayBuffer());
        // A `.starline` file is a database, not an interchange document: open it directly
        // (spec 4.5.2). Everything else goes through the interchange importer.
        if (/\\.starline$/i.test(file.name) || looksLikeStarline(bytes)) {
          const result = await openStarlineLibrary(bytes, file.name);
          setNotice(`${result.libraryName}: ${messages.app.openedDirectly}`);
          onOpen({ ...result.session, readOnly: result.session.readOnly ?? false });
          return;
        }
        const result = await importIntoNewLibrary(bytes, file.name, (stage) => {
          setImporting(
            stage === "reading"
              ? messages.app.readingFile
              : stage === "creating"
                ? messages.app.creatingLibrary
                : messages.app.writingProject,
          );
        });
        const rows = Object.values(result.report.counts).reduce((sum, count) => sum + count, 0);
        setNotice(
          result.report.issues.length > 0
            ? `${result.libraryName}: ${rows} rows imported, ${result.report.issues.length} issue(s)`
            : `${result.libraryName}: ${rows} rows imported`,
        );
        setIssues(result.report.issues);
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
          <p className="mt-2 text-sm text-muted">{messages.app.tagline}</p>
          {offered ? (
            <div className="sl-card mt-4 flex flex-col gap-2 p-4" data-testid="sl-tour-offer">
              <p className="text-sm font-medium">{messages.tour.offer.title}</p>
              <p className="text-sm text-muted">{messages.tour.offer.body}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="sl-btn sl-btn-primary"
                  data-testid="sl-tour-offer-start"
                  onClick={startTour}
                >
                  {messages.tour.offer.start}
                </button>
                <button
                  type="button"
                  className="sl-btn"
                  data-testid="sl-tour-offer-dismiss"
                  onClick={dismissOffer}
                >
                  {messages.tour.offer.dismiss}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="sl-btn mt-4"
              data-testid="sl-tour-open"
              onClick={startTour}
            >
              {messages.tour.open}
            </button>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="sl-chip">{messages.app.offlineChip}</span>
            <span className="sl-chip">{messages.app.onDeviceChip}</span>
            <span className="sl-chip">{messages.app.installableChip}</span>
          </div>
        </div>
        <ThemeButton />
      </header>

      <section className="sl-card p-5">
        <h2 className="text-sm font-medium text-muted">{messages.app.createHeading}</h2>
        <div className="mt-3 flex gap-2">
          <input
            className="sl-input flex-1"
            placeholder={messages.app.namePlaceholder}
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
            {messages.app.create}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">{messages.app.reuseHint}</p>
      </section>

      <section className="sl-card p-5">
        <h2 className="text-sm font-medium text-muted">{messages.app.importHeading}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="sl-btn"
            data-testid="sl-import-file"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            {importing ?? messages.app.chooseFile}
          </button>
          <span className="text-xs text-muted">{messages.app.importHint}</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          data-testid="sl-import-input"
          accept=".json,.zip,.starline,application/json,application/zip,application/octet-stream"
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
        {issues.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1" data-testid="sl-import-issues">
            {issues.map((issue) => (
              <li
                key={`${issue.where ?? "issue"}-${issue.message}`}
                className="text-xs text-muted"
                data-severity={issue.severity}
              >
                {issue.severity === "error" ? "✕" : "!"} {issue.message}
                {issue.where ? ` (${issue.where})` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="sl-card p-5">
        <h2 className="text-sm font-medium text-muted">{messages.app.librariesHeading}</h2>
        {libraries.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{messages.app.noLibraries}</p>
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
                    {messages.app.open}
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

      <footer className="flex flex-col gap-1 text-center text-xs text-muted">
        <span>{messages.app.installHint}</span>
        <span>{messages.app.credit}</span>
      </footer>
    </div>
  );
}
