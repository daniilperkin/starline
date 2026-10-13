/**
 * The notes incubator (spec §4.4.2, PLAN slice 14): a quick-capture line at the top and a four
 * column board — Inbox → Incubating → Used → Archived — that swipes horizontally on a phone and
 * lays out as columns on a wider screen. Promoting a note hands it to the real entity editors.
 */
import {
  messages,
  NOTE_KIND_GLYPHS,
  NOTE_KINDS,
  NOTE_STATUS_COLORS,
  NOTE_STATUSES,
  type NoteKind,
  type NoteStatus,
  type NoteSummary,
  plural,
  type UUID,
} from "@starline/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveProject } from "./active-project";
import { useCreateNote, useMoveNote, useNoteCounts, useNotes, useProjects } from "./data";
import { NoteSheet } from "./NoteSheet";

function relativeDay(at: number): string {
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return messages.time.today;
  if (days === 1) return messages.time.yesterday;
  return plural(messages.time.daysAgo, days);
}

function NoteRow({
  note,
  onOpen,
  onMove,
}: {
  note: NoteSummary;
  onOpen: () => void;
  onMove: (status: NoteStatus) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const snippet = note.body.text.split("\n").find((line) => line.trim().length > 0) ?? "";
  return (
    <li
      className="sl-note-row"
      data-note-id={note.id}
      style={{ borderLeftColor: NOTE_STATUS_COLORS[note.status] }}
    >
      <button
        type="button"
        className="sl-note-row-main"
        data-testid={`sl-note-${note.id}`}
        onClick={onOpen}
      >
        <span className="sl-note-row-head">
          {note.pinned ? <span className="sl-pin">★</span> : null}
          <span className="sl-note-row-title">
            {note.title.trim() || snippet || messages.notes.heading}
          </span>
          <span className="sl-note-row-kind" title={messages.notes.kind[note.kind]}>
            {NOTE_KIND_GLYPHS[note.kind]}
          </span>
        </span>
        <span className="sl-note-row-meta">
          {messages.notes.kind[note.kind]}
          {snippet ? ` · ${snippet.slice(0, 70)}` : ""} · {relativeDay(note.updatedAt)}
        </span>
      </button>
      <div className="sl-note-row-menu">
        <button
          type="button"
          className="sl-btn sl-btn-small"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={messages.notes.move}
          data-testid={`sl-note-move-${note.id}`}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="sl-menu" role="menu">
            {NOTE_STATUSES.filter((status) => status !== note.status).map((status) => (
              <button
                key={status}
                type="button"
                role="menuitem"
                className="sl-menu-item"
                data-testid={`sl-note-move-${note.id}-${status}`}
                onClick={() => {
                  setMenuOpen(false);
                  onMove(status);
                }}
              >
                {messages.notes.status[status]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function NotesScreen() {
  const { project } = useActiveProject();
  const projectId = project?.id ?? null;
  const navigate = useNavigate();
  const search = useSearch({ from: "/notes" });
  const counts = useNoteCounts(projectId);
  const createNote = useCreateNote();
  const moveNote = useMoveNote();

  const [capture, setCapture] = useState("");
  const [kind, setKind] = useState<NoteKind | null>(null);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [column, setColumn] = useState<NoteStatus>("inbox");
  const [openNoteId, setOpenNoteId] = useState<UUID | null>(null);
  const captureRef = useRef<HTMLInputElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const notes = useNotes(projectId, {
    kind: kind ?? undefined,
    pinnedOnly,
    search: query.trim().length > 0 ? query : undefined,
  });

  const byColumn = useMemo(() => {
    const grouped: Record<NoteStatus, NoteSummary[]> = {
      inbox: [],
      incubating: [],
      used: [],
      archived: [],
    };
    for (const note of notes.data ?? []) grouped[note.status].push(note);
    return grouped;
  }, [notes.data]);

  // The PWA shortcut ("Quick capture") lands on /notes?capture=1 and drops the caret in the box.
  useEffect(() => {
    if (search.capture === "1") {
      captureRef.current?.focus();
      void navigate({ to: "/notes", search: {}, replace: true });
    }
  }, [search.capture, navigate]);

  const submitCapture = async () => {
    const title = capture.trim();
    if (title.length === 0 || projectId === null) return;
    setCapture("");
    await createNote.mutateAsync({ projectId, title }).catch(() => undefined);
  };

  const onMove = async (noteId: UUID, status: NoteStatus) => {
    await moveNote
      .mutateAsync({ projectId: projectId as UUID, noteId, status })
      .catch(() => undefined);
  };

  const scrollToColumn = (status: NoteStatus) => {
    setColumn(status);
    const track = trackRef.current;
    const index = NOTE_STATUSES.indexOf(status);
    if (track !== null) {
      track.scrollTo({ left: track.clientWidth * index, behavior: "smooth" });
    }
  };

  const onTrackScroll = () => {
    const track = trackRef.current;
    if (track === null || track.clientWidth === 0) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    const next = NOTE_STATUSES[index];
    if (next !== undefined && next !== column) setColumn(next);
  };

  if (projectId === null) {
    return <p className="text-sm text-muted">{messages.common.loading}</p>;
  }

  return (
    <div className="sl-notes">
      <header className="sl-notes-head">
        <h1 className="sl-heading">{messages.notes.heading}</h1>
        <p className="text-sm text-muted">{messages.notes.board}</p>
      </header>

      <div className="sl-capture">
        <input
          ref={captureRef}
          className="sl-capture-input"
          data-testid="sl-capture-input"
          placeholder={messages.notes.capturePlaceholder}
          value={capture}
          onChange={(event) => setCapture(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submitCapture();
          }}
          aria-label={messages.notes.capturePlaceholder}
        />
        <button
          type="button"
          className="sl-btn sl-btn-primary"
          data-testid="sl-capture-save"
          disabled={capture.trim().length === 0 || createNote.isPending}
          onClick={() => void submitCapture()}
        >
          {messages.notes.capture}
        </button>
      </div>
      <p className="sl-capture-hint text-xs text-muted">{messages.notes.captureHint}</p>

      <div className="sl-notes-filters">
        <select
          className="sl-select"
          value={kind ?? ""}
          data-testid="sl-notes-kind-filter"
          aria-label={messages.notes.kindLabel}
          onChange={(event) => setKind((event.target.value || null) as NoteKind | null)}
        >
          <option value="">{messages.notes.allKinds}</option>
          {NOTE_KINDS.map((value) => (
            <option key={value} value={value}>
              {NOTE_KIND_GLYPHS[value]} {messages.notes.kind[value]}
            </option>
          ))}
        </select>
        <label className="sl-chip-toggle">
          <input
            type="checkbox"
            checked={pinnedOnly}
            onChange={(event) => setPinnedOnly(event.target.checked)}
          />
          <span>{messages.notes.pinnedOnly}</span>
        </label>
        <input
          className="sl-search-input"
          type="search"
          data-testid="sl-notes-search"
          placeholder={messages.notes.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={messages.notes.searchPlaceholder}
        />
      </div>

      <div className="sl-notes-tabs" role="tablist" aria-label={messages.notes.board}>
        {NOTE_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={column === status}
            data-on={column === status}
            className="sl-seg-item"
            data-testid={`sl-notes-tab-${status}`}
            onClick={() => scrollToColumn(status)}
          >
            {messages.notes.status[status]}
            <span className="sl-chip-count">{counts.data?.[status] ?? 0}</span>
          </button>
        ))}
      </div>

      <div
        className="sl-board"
        ref={trackRef}
        onScroll={onTrackScroll}
        data-testid="sl-notes-board"
      >
        {NOTE_STATUSES.map((status) => (
          <section
            key={status}
            className="sl-board-column"
            data-testid={`sl-notes-column-${status}`}
            aria-label={messages.notes.status[status]}
          >
            <h2 className="sl-board-head" style={{ color: NOTE_STATUS_COLORS[status] }}>
              {messages.notes.status[status]}
              <span className="sl-chip-count">{counts.data?.[status] ?? 0}</span>
            </h2>
            {byColumn[status].length === 0 ? (
              <p className="sl-board-empty text-xs text-muted">{messages.notes.emptyColumn}</p>
            ) : (
              <ul className="sl-note-list">
                {byColumn[status].map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    onOpen={() => setOpenNoteId(note.id)}
                    onMove={(next) => void onMove(note.id, next)}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {(notes.data ?? []).length === 0 &&
      query.trim().length === 0 &&
      kind === null &&
      !pinnedOnly ? (
        <p className="sl-board-empty text-sm text-muted" data-testid="sl-notes-empty">
          {messages.notes.empty}
        </p>
      ) : null}

      {openNoteId !== null ? (
        <NoteSheet projectId={projectId} noteId={openNoteId} onClose={() => setOpenNoteId(null)} />
      ) : null}
    </div>
  );
}
