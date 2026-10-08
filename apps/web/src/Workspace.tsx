import { useState } from "react";
import type { LibrarySession } from "./App";
import { cycleTheme, getThemePreference, type ThemePreference } from "./theme";

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export function Workspace({
  session,
  onClose,
}: {
  session: LibrarySession;
  onClose: () => Promise<void>;
}) {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference());
  const [closing, setClosing] = useState(false);
  const { info, report } = session;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{session.name}</h1>
          <p className="text-sm text-muted">StarLine library</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="sl-btn" onClick={() => setTheme(cycleTheme())}>
            {THEME_LABEL[theme]}
          </button>
          <button
            type="button"
            className="sl-btn"
            disabled={closing}
            onClick={async () => {
              setClosing(true);
              await onClose();
            }}
          >
            {closing ? "Closing…" : "Close library"}
          </button>
        </div>
      </header>

      <section className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2">
        <Stat label="Schema version" value={`v${report.to}`} />
        <Stat label="Revision" value={String(info.revision)} />
        <Stat label="application_id" value={`0x${info.applicationId.toString(16).toUpperCase()}`} />
        <Stat
          label="Migrations applied on open"
          value={report.applied.length > 0 ? report.applied.join(", ") : "none (already current)"}
        />
      </section>

      <p className="text-sm text-muted">
        Storage: OPFS sahpool via sqlite-wasm (web build). The desktop shell opens the same library
        file through the native rusqlite driver — same contract, same schema.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}
