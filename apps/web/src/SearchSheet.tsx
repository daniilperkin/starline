import { format, messages, type SearchEntityType, type SearchHit, type UUID } from "@starline/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSearch } from "./data";

/**
 * Global search sheet (PLAN slice 7): FTS5 + trigram over characters, lore, scenes, chapters and
 * notes, grouped by type with a context line and a snippet per hit. Fuzzy (trigram) hits are
 * marked, because a name you half-remember is the common case on a phone keyboard.
 *
 * Recents live in localStorage — they are UI state about this device, not book data, so they
 * never touch the library file.
 */

const RECENTS_KEY = "starline.search.recents";
const RECENTS_MAX = 5;

const GROUP_GLYPHS: Record<SearchEntityType, string> = {
  character: "◍",
  lore: "✧",
  scene: "▤",
  chapter: "❖",
  note: "✎",
};

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeRecents(list: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    // storage disabled — recents are a nicety, never a failure
  }
}

export interface SearchSheetProps {
  projectId: UUID | null;
  onClose: () => void;
  onOpenHit: (hit: SearchHit) => void;
}

export function SearchSheet({ projectId, onClose, onOpenHit }: SearchSheetProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 140);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const results = useSearch(projectId, debounced);
  const trimmed = debounced.trim();
  const groups = results.data?.groups ?? [];
  const hits = useMemo(() => groups.flatMap((group) => group.hits), [groups]);

  const remember = (value: string) => {
    const next = [value, ...recents.filter((item) => item !== value)].slice(0, RECENTS_MAX);
    setRecents(next);
    writeRecents(next);
  };

  const openHit = (hit: SearchHit) => {
    remember(trimmed);
    onOpenHit(hit);
    onClose();
  };

  const searching = trimmed.length >= 2;
  const showEmpty = searching && results.isFetched && hits.length === 0;

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.search.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet sl-search-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={messages.search.title}
      >
        <header className="flex items-center gap-2">
          <h2 className="text-base font-semibold">{messages.search.title}</h2>
          <button type="button" className="sl-btn-small ml-auto" onClick={onClose}>
            {messages.common.cancel}
          </button>
        </header>

        <label className="sr-only" htmlFor="sl-search-input">
          {messages.search.placeholder}
        </label>
        <input
          id="sl-search-input"
          ref={inputRef}
          className="sl-input sl-search-input"
          type="search"
          autoComplete="off"
          placeholder={messages.search.placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hits[0]) openHit(hits[0]);
          }}
        />

        {!searching ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">{messages.search.hint}</p>
            {recents.length > 0 ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <h3 className="sl-label mb-0">{messages.search.recents}</h3>
                  <button
                    type="button"
                    className="sl-btn-small ml-auto"
                    onClick={() => {
                      setRecents([]);
                      writeRecents([]);
                    }}
                  >
                    {messages.search.clearRecents}
                  </button>
                </div>
                <ul className="sl-search-recents">
                  {recents.map((item) => (
                    <li key={item}>
                      <button
                        type="button"
                        className="sl-search-recent"
                        onClick={() => setQuery(item)}
                      >
                        {item}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {showEmpty ? (
          <div className="sl-empty">
            <p className="text-sm font-medium">
              {format(messages.search.empty, { query: trimmed })}
            </p>
            <p className="mt-1 text-xs text-muted">{messages.search.emptyHint}</p>
          </div>
        ) : null}

        {groups.length > 0 ? (
          <div className="flex flex-col gap-4" data-testid="sl-search-results">
            {groups.map((group) => (
              <div key={group.entityType} className="flex flex-col gap-1">
                <h3 className="sl-label mb-0">
                  {messages.search.groups[group.entityType] ?? group.entityType}
                </h3>
                <ul className="sl-search-list">
                  {group.hits.map((hit) => (
                    <li key={`${hit.entityType}:${hit.entityId}`}>
                      <button
                        type="button"
                        className="sl-search-hit"
                        data-entity-type={hit.entityType}
                        onClick={() => openHit(hit)}
                      >
                        <span className="sl-search-glyph" aria-hidden="true">
                          {GROUP_GLYPHS[hit.entityType] ?? "•"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="sl-search-title">{hit.title || "—"}</span>
                          {hit.detail ? (
                            <span className="sl-search-detail">{hit.detail}</span>
                          ) : null}
                          {hit.snippet ? (
                            <span className="sl-search-snippet">{hit.snippet}</span>
                          ) : null}
                        </span>
                        {hit.fuzzy ? (
                          <span className="sl-chip">{messages.search.fuzzy}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
