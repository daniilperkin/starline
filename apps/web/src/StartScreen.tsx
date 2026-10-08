import type { MigrationReport } from "@starline/db";
import { runMigrations } from "@starline/db";
import { useCallback, useEffect, useState } from "react";
import type { LibrarySession } from "./App";
import { createLibrarySession, listLibraries } from "./storage";
import { cycleTheme, getThemePreference, type ThemePreference } from "./theme";

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export function StartScreen({ onOpen }: { onOpen: (session: LibrarySession) => void }) {
  const [libraries, setLibraries] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference());

  const refresh = useCallback(async () => {
    try {
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
      const { driver, transport } = createLibrarySession();
      try {
        const info = await driver.open({ path: `${name}.starline`, create, readOnly: false });
        const report: MigrationReport = await runMigrations(driver);
        onOpen({ driver, transport, name, info, report });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        await driver.close().catch(() => undefined);
        await transport.dispose().catch(() => undefined);
      } finally {
        setBusy(false);
      }
    },
    [onOpen],
  );

  const createName = newName.trim().replace(/\.starline$/i, "");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-8 p-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">StarLine</h1>
          <p className="mt-1 text-sm text-muted">
            Offline novel-planning workstation — libraries live in your browser storage.
          </p>
        </div>
        <button type="button" className="sl-btn" onClick={() => setTheme(cycleTheme())}>
          {THEME_LABEL[theme]}
        </button>
      </header>

      <section className="rounded-xl border border-line bg-surface p-6">
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
            className="sl-btn"
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

      <section className="rounded-xl border border-line bg-surface p-6">
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
                  className="flex items-center justify-between rounded-lg border border-line px-3 py-2"
                >
                  <span className="text-sm">{displayName}</span>
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
        <p className="rounded-lg border border-danger px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}
    </div>
  );
}
