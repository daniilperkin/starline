import { messages, type SearchHit } from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveProject } from "./active-project";
import { useSearch } from "./data";
import { useOpenEntity } from "./openEntity";
import { useSessionStore } from "./session";
import { takeSnapshot } from "./snapshots";

/**
 * The command palette (spec §4.4, Ctrl/Cmd+K): entities through the same FTS + trigram search the
 * search sheet uses, plus the commands a writer reaches for — every tab, the key screens, and a
 * snapshot. Grouped by kind, arrow keys and Enter, and it closes itself the moment it acts.
 *
 * The spec named `cmdk` for this; the library rendered nothing in this app's build (verified by
 * rendering it unconditionally — zero DOM nodes, no errors, with the code present in the bundle),
 * so the list semantics are hand-rolled here instead. That means owning what cmdk would have
 * given: the combobox roles, aria-activedescendant, arrow navigation and Enter.
 */

const GROUP_GLYPHS: Record<string, string> = {
  character: "◍",
  lore: "✧",
  scene: "▤",
  chapter: "§",
  note: "✎",
};

interface PaletteEntry {
  key: string;
  glyph: string;
  label: string;
  detail: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { project } = useActiveProject();
  const navigate = useNavigate();
  const openEntity = useOpenEntity();
  const session = useSessionStore((state) => state.session);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const searching = query.trim().length >= 2;
  const results = useSearch(project?.id ?? null, searching ? query.trim() : "");
  const groups = results.data?.groups ?? [];

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setActive(0);
  }, [onOpenChange]);

  const run = (action: () => void) => {
    close();
    action();
  };

  const entries = useMemo<PaletteEntry[]>(() => {
    const needle = query.trim().toLowerCase();
    const commands: PaletteEntry[] = [
      {
        key: "plan",
        glyph: "✦",
        label: messages.tabs.plan,
        detail: "",
        run: () => void navigate({ to: "/plan" }),
      },
      {
        key: "scenes",
        glyph: "▤",
        label: messages.tabs.scenes,
        detail: "",
        run: () => void navigate({ to: "/scenes" }),
      },
      {
        key: "people",
        glyph: "◍",
        label: messages.tabs.people,
        detail: "",
        run: () => void navigate({ to: "/people" }),
      },
      {
        key: "world",
        glyph: "✧",
        label: messages.tabs.world,
        detail: "",
        run: () => void navigate({ to: "/world" }),
      },
      {
        key: "notes",
        glyph: "✎",
        label: messages.tabs.notes,
        detail: "",
        run: () => void navigate({ to: "/notes" }),
      },
      {
        key: "settings",
        glyph: "⚙",
        label: messages.settings.open,
        detail: "",
        run: () => void navigate({ to: "/settings" }),
      },
      {
        key: "export",
        glyph: "⬇",
        label: messages.export.open,
        detail: "",
        run: () => void navigate({ to: "/export" }),
      },
      {
        key: "backups",
        glyph: "◈",
        label: messages.backups.open,
        detail: "",
        run: () => void navigate({ to: "/backups" }),
      },
      {
        key: "checks",
        glyph: "✓",
        label: messages.checks.open,
        detail: "",
        run: () => void navigate({ to: "/checks" }),
      },
      {
        key: "trash",
        glyph: "⌫",
        label: messages.trash.open,
        detail: "",
        run: () => void navigate({ to: "/trash" }),
      },
    ];
    if (session !== null) {
      commands.push({
        key: "snapshot",
        glyph: "★",
        label: messages.snapshot.now,
        detail: "",
        run: () => {
          void takeSnapshot(session, "manual", "").catch(() => undefined);
        },
      });
    }
    const matchedCommands = commands.filter(
      (entry) =>
        needle === "" || entry.label.toLowerCase().includes(needle) || entry.key.includes(needle),
    );
    const hitEntries: PaletteEntry[] = groups.flatMap((group) =>
      group.hits.map((hit: SearchHit) => ({
        key: `${hit.entityType}:${hit.entityId}`,
        glyph: GROUP_GLYPHS[hit.entityType] ?? "•",
        label: hit.title || "—",
        detail: hit.detail,
        run: () => openEntity(hit.entityType, hit.entityId),
      })),
    );
    return [...matchedCommands, ...hitEntries];
  }, [groups, navigate, openEntity, query, session]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting the highlight when the query changes is the point
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted row in view as the writer arrows through the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect reads the rendered DOM by design
  useEffect(() => {
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(entries.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = entries[active];
      if (entry) run(entry.run);
    }
  };

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.common.close}
        onClick={close}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={messages.palette.title}
        className="sl-palette"
        data-testid="sl-palette"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="sl-palette-list"
          aria-activedescendant={entries[active] ? `sl-palette-${entries[active].key}` : undefined}
          aria-label={messages.palette.title}
          className="sl-input"
          data-testid="sl-palette-input"
          placeholder={messages.palette.placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKey}
        />
        <p className="sl-palette-group" data-testid="sl-palette-heading">
          {messages.palette.commands}
        </p>
        {/* biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA's listbox/option pattern on a ul is deliberate */}
        <ul id="sl-palette-list" role="listbox" aria-label={messages.palette.title} ref={listRef}>
          {entries.length === 0 ? (
            <li className="sl-palette-empty">{messages.palette.empty}</li>
          ) : (
            entries.map((entry, index) => (
              <li key={entry.key}>
                <button
                  type="button"
                  id={`sl-palette-${entry.key}`}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  className="sl-palette-item"
                  data-testid={entry.key.includes(":") ? "sl-palette-hit" : "sl-palette-command"}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(entry.run)}
                >
                  <span className="sl-search-glyph" aria-hidden="true">
                    {entry.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sl-search-title">{entry.label}</span>
                    {entry.detail ? <span className="sl-search-detail">{entry.detail}</span> : null}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </>
  );
}
