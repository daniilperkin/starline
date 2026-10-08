import { messages } from "@starline/core";
import { useEffect, useState } from "react";

/** Bottom sheet for the "Find characters in this text" trigger (spec §3.4.3). */
export function ExtractSheet({
  candidates,
  busy,
  onConfirm,
  onClose,
}: {
  candidates: readonly string[];
  busy: boolean;
  onConfirm: (names: string[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(candidates));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (name: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selected = candidates.filter((name) => checked.has(name));

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.common.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={messages.step3.extractHeading}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{messages.step3.extractHeading}</h2>
          <button
            type="button"
            className="sl-btn"
            aria-label={messages.common.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <p className="mt-1 text-xs text-muted">{messages.step3.extractHint}</p>

        {candidates.length === 0 ? (
          <p className="mt-4 mb-1 text-sm">{messages.step3.extractNone}</p>
        ) : (
          <>
            <ul className="mt-3 flex flex-col gap-1">
              {candidates.map((name) => (
                <li key={name}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked.has(name)}
                      onChange={() => toggle(name)}
                    />
                    <span className="text-sm">{name}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="sl-btn sl-btn-primary mt-4"
              disabled={selected.length === 0 || busy}
              onClick={() => onConfirm(selected)}
            >
              {messages.step3.extractConfirm}
            </button>
          </>
        )}
      </section>
    </>
  );
}
