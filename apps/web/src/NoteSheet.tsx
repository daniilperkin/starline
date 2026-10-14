/**
 * One note, fully editable (PLAN slice 14): title, kind, column, rich-text body with `@`-mentions,
 * a source link the app never fetches, and the promote row that turns the thought into a real
 * entity. Everything autosaves; kind/column/pin apply immediately because they are single taps.
 */
import {
  LORE_KINDS,
  type LoreKind,
  messages,
  NOTE_KIND_GLYPHS,
  NOTE_KINDS,
  NOTE_STATUSES,
  NOTE_TITLE_MAX,
  type NoteKind,
  type NoteStatus,
  PROMOTE_TARGETS,
  type PromoteTarget,
  type RichText,
  type UUID,
} from "@starline/core";
import { useEffect, useRef, useState } from "react";
import { BacklinksPanel } from "./BacklinksPanel";
import {
  useDeleteCharacter,
  useDeleteLoreEntry,
  useDeleteNote,
  useDeletePlotline,
  useDeleteScene,
  useMentionables,
  useMoveNote,
  useNote,
  usePromoteNote,
  useRestoreEntity,
  useUpdateNote,
} from "./data";
import { useOpenEntity } from "./openEntity";
import { RichTextEditor } from "./RichTextEditor";
import { useUndoStore } from "./undo";
import { useAutosave } from "./useAutosave";

interface Draft {
  title: string;
  body: RichText | null;
  sourceUrl: string;
}

const PROMOTE_LABELS: Record<PromoteTarget, string> = {
  scene: messages.notes.promoteScene,
  character: messages.notes.promoteCharacter,
  lore: messages.notes.promoteLore,
  plotline: messages.notes.promotePlotline,
};

export function NoteSheet({
  projectId,
  noteId,
  onClose,
}: {
  projectId: UUID;
  noteId: UUID;
  onClose: () => void;
}) {
  const note = useNote(projectId, noteId);
  const mentionables = useMentionables(projectId);
  const update = useUpdateNote();
  const move = useMoveNote();
  const promote = usePromoteNote();
  const remove = useDeleteNote();
  const restore = useRestoreEntity();
  const deleteScene = useDeleteScene();
  const deleteCharacter = useDeleteCharacter();
  const deleteLoreEntry = useDeleteLoreEntry();
  const deletePlotline = useDeletePlotline();
  const pushUndo = useUndoStore((state) => state.push);
  const openEntity = useOpenEntity();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [loreKind, setLoreKind] = useState<LoreKind>("location");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promotedKind, setPromotedKind] = useState<PromoteTarget | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const loaded = note.data;
  useEffect(() => {
    if (!loaded || draft !== null) return;
    setDraft({
      title: loaded.title,
      body: loaded.body.json === null ? null : loaded.body,
      sourceUrl: loaded.sourceUrl,
    });
  }, [loaded, draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useAutosave(draft, async (value) => {
    if (value === null) return true;
    try {
      await update.mutateAsync({
        projectId,
        noteId,
        patch: {
          title: value.title.slice(0, NOTE_TITLE_MAX),
          sourceUrl: value.sourceUrl.trim(),
          ...(value.body === null ? {} : { body: value.body }),
        },
      });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  });

  const setStatus = async (status: NoteStatus) => {
    await move.mutateAsync({ projectId, noteId, status }).catch(() => undefined);
  };

  const setKind = async (kind: NoteKind) => {
    await update.mutateAsync({ projectId, noteId, patch: { kind } }).catch(() => undefined);
  };

  const togglePinned = async () => {
    if (!loaded) return;
    await update
      .mutateAsync({ projectId, noteId, patch: { pinned: !loaded.pinned } })
      .catch(() => undefined);
  };

  const onPromote = async (target: PromoteTarget) => {
    setError(null);
    try {
      const result = await promote.mutateAsync({
        projectId,
        noteId,
        target,
        ...(target === "lore" ? { loreKind } : {}),
      });
      setPromotedKind(target);
      pushUndo(messages.undo.notePromoted, async () => {
        // The inverse is real commands: trash the new entity, unlink the note, restore its column.
        if (target === "scene") {
          await deleteScene
            .mutateAsync({ projectId, sceneId: result.entityId })
            .catch(() => undefined);
        } else if (target === "character") {
          await deleteCharacter
            .mutateAsync({ projectId, characterId: result.entityId })
            .catch(() => undefined);
        } else if (target === "lore") {
          await deleteLoreEntry
            .mutateAsync({ projectId, entryId: result.entityId })
            .catch(() => undefined);
        } else {
          await deletePlotline
            .mutateAsync({ projectId, plotlineId: result.entityId })
            .catch(() => undefined);
        }
        await update
          .mutateAsync({
            projectId,
            noteId,
            patch: { promoted: null, status: result.previousStatus },
          })
          .catch(() => undefined);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await remove.mutateAsync({ projectId, noteId }).catch(() => undefined);
    pushUndo(messages.undo.noteDeleted, async () => {
      await restore.mutateAsync({ projectId, entityType: "note", entityId: noteId });
    });
    onClose();
  };

  if (!loaded) {
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
          aria-label={messages.notes.heading}
        >
          <p className="text-sm text-muted">{messages.common.loading}</p>
        </section>
      </>
    );
  }

  const promotedTo = promotedKind ?? (loaded.promotedToType as PromoteTarget | null);
  const canOpenPromoted =
    promotedTo === "scene" || promotedTo === "character" || promotedTo === "lore";

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.common.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet sl-note-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={loaded.title || messages.notes.heading}
      >
        <header className="sl-sheet-head">
          <input
            ref={titleRef}
            className="sl-note-title"
            data-testid="sl-note-title"
            placeholder={messages.notes.titlePlaceholder}
            value={draft?.title ?? ""}
            onChange={(event) =>
              setDraft((previous) =>
                previous ? { ...previous, title: event.target.value } : previous,
              )
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <button
            type="button"
            className="sl-btn sl-btn-small"
            data-testid="sl-note-pin"
            aria-pressed={loaded.pinned}
            title={loaded.pinned ? messages.notes.unpin : messages.notes.pin}
            onClick={togglePinned}
          >
            ★
          </button>
          <button
            type="button"
            className="sl-btn sl-btn-small"
            aria-label={messages.common.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="sl-note-meta">
          <label className="sl-fieldset">
            <span>{messages.notes.kindLabel}</span>
            <select
              value={loaded.kind}
              data-testid="sl-note-kind"
              onChange={(event) => void setKind(event.target.value as NoteKind)}
            >
              {NOTE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {NOTE_KIND_GLYPHS[kind]} {messages.notes.kind[kind]}
                </option>
              ))}
            </select>
          </label>
          <div className="sl-fieldset">
            <span>{messages.notes.statusLabel}</span>
            <fieldset className="sl-seg sl-seg-plain">
              {NOTE_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  className="sl-seg-item"
                  data-testid={`sl-note-status-${status}`}
                  data-on={loaded.status === status}
                  onClick={() => void setStatus(status)}
                >
                  {messages.notes.status[status]}
                </button>
              ))}
            </fieldset>
          </div>
        </div>

        <div className="sl-note-body">
          <span className="sl-label">{messages.notes.bodyLabel}</span>
          <RichTextEditor
            initial={loaded.body}
            ariaLabel={messages.notes.bodyLabel}
            mentionables={mentionables.data ?? []}
            onChange={(value) =>
              setDraft((previous) => (previous ? { ...previous, body: value } : previous))
            }
          />
        </div>

        <label className="sl-field sl-note-source">
          <span>{messages.notes.sourceLabel}</span>
          <div className="sl-note-source-row">
            <input
              type="url"
              inputMode="url"
              placeholder={messages.notes.sourcePlaceholder}
              value={draft?.sourceUrl ?? ""}
              onChange={(event) =>
                setDraft((previous) =>
                  previous ? { ...previous, sourceUrl: event.target.value } : previous,
                )
              }
            />
            {loaded.sourceUrl.trim().length > 0 ? (
              // The app never fetches this: the system browser opens it (spec §4.4.2).
              <a
                className="sl-btn"
                href={loaded.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {messages.notes.openSource}
              </a>
            ) : null}
          </div>
        </label>

        <section className="sl-note-promote">
          <span className="sl-label">{messages.notes.promoteHeading}</span>
          <div className="sl-note-promote-row">
            {PROMOTE_TARGETS.map((target) => (
              <button
                key={target}
                type="button"
                className="sl-btn"
                data-testid={`sl-note-promote-${target}`}
                disabled={promote.isPending}
                onClick={() => void onPromote(target)}
              >
                {PROMOTE_LABELS[target]}
              </button>
            ))}
            <label className="sl-field sl-note-lore-kind">
              <span>{messages.notes.loreKindLabel}</span>
              <select
                value={loreKind}
                data-testid="sl-note-lore-kind"
                onChange={(event) => setLoreKind(event.target.value as LoreKind)}
              >
                {LORE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {promotedTo !== null && loaded.promotedToId !== null ? (
            <p className="sl-note-promoted" data-testid="sl-note-promoted">
              {messages.notes.promotedTo.replace("{kind}", PROMOTE_LABELS[promotedTo])}{" "}
              {canOpenPromoted ? (
                <button
                  type="button"
                  className="sl-link"
                  onClick={() => openEntity(promotedTo, loaded.promotedToId as UUID)}
                >
                  {messages.notes.promotedLink}
                </button>
              ) : null}
            </p>
          ) : null}
        </section>

        {error !== null ? <p className="sl-error">{error}</p> : null}

        <BacklinksPanel
          projectId={projectId}
          targetType="note"
          targetId={noteId}
          onNavigate={() => onClose()}
        />

        <footer className="sl-sheet-foot">
          <button
            type="button"
            className="sl-btn"
            data-danger="true"
            {...(confirmDelete ? { "data-armed": "true" } : {})}
            data-testid="sl-note-delete"
            onClick={() => void onDelete()}
          >
            {confirmDelete ? messages.notes.deleteConfirm : messages.notes.delete}
          </button>
        </footer>
      </section>
    </>
  );
}
