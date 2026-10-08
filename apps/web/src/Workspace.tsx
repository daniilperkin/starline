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
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-5 py-10">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            <span aria-hidden="true" className="mr-1 text-accent">
              ✦
            </span>
            {session.name}
          </h1>
          <p className="text-sm text-muted">StarLine library</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="sl-btn" onClick={() => setTheme(cycleTheme())}>
            {THEME_LABEL[theme]}
          </button>
        </div>
      </header>

      <section className="sl-card grid gap-4 p-5 sm:grid-cols-2">
        <Stat label="Schema version" value={`v${report.to}`} />
        <Stat label="Revision" value={String(info.revision)} />
        <Stat label="application_id" value={`0x${info.applicationId.toString(16).toUpperCase()}`} />
        <Stat
          label="Migrations applied on open"
          value={report.applied.length > 0 ? report.applied.join(", ") : "none (already current)"}
        />
      </section>

      <p className="text-sm text-muted">
        Stored on this device (OPFS · sqlite-wasm) and installable as an app — everything keeps
        working with the network off.
      </p>

      <button
        type="button"
        className="sl-btn w-full sm:w-auto sm:self-end"
        disabled={closing}
        onClick={async () => {
          setClosing(true);
          await onClose();
        }}
      >
        {closing ? "Closing…" : "Close library"}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-sm break-all">{value}</div>
    </div>
  );
}
