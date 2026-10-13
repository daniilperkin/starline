import { format, messages, type UUID } from "@starline/core";
import { useEffect, useState } from "react";
import { useActiveProject } from "./active-project";
import { useCreateProject, useDeleteProject, useRenameProject, useRestoreProject } from "./data";
import { useUndoStore } from "./undo";

/**
 * Books in this library (slice 23). The library file has always held many books; this is where a
 * writer chooses which one is open, renames one, deletes one (undoable, like every other entity)
 * or starts a new one. Switching never touches data — it changes which project every screen reads,
 * through the one hook that answers that question.
 */
export function BookSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project, books, choose } = useActiveProject();
  const create = useCreateProject();
  const rename = useRenameProject();
  const remove = useDeleteProject();
  const restore = useRestoreProject();
  const pushUndo = useUndoStore((state) => state.push);

  const [renamingId, setRenamingId] = useState<UUID | null>(null);
  const [renameText, setRenameText] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [confirmId, setConfirmId] = useState<UUID | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onRename = async (id: UUID) => {
    const title = renameText.trim();
    if (title.length === 0) return;
    await rename.mutateAsync({ projectId: id, title });
    setRenamingId(null);
  };

  const onDelete = async (id: UUID, title: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      window.setTimeout(() => setConfirmId(null), 2500);
      return;
    }
    setConfirmId(null);
    await remove.mutateAsync({ projectId: id });
    // Deleting the book you are reading falls back to the first remaining one, which is exactly
    // what the active-project hook does when the chosen id no longer resolves.
    if (project?.id === id) choose(null);
    pushUndo(messages.books.deleted.replace("{title}", title), async () => {
      await restore.mutateAsync({ projectId: id });
    });
  };

  const onCreate = async () => {
    const title = newTitle.trim();
    if (title.length === 0) return;
    setNewTitle("");
    const result = await create.mutateAsync(title);
    const created = (result as { projectId?: UUID } | undefined)?.projectId;
    if (created !== undefined) choose(created);
    onClose();
  };

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
        aria-label={messages.books.heading}
        data-testid="sl-book-sheet"
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{messages.books.heading}</h2>
          <button
            type="button"
            className="sl-btn"
            aria-label={messages.common.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <p className="mt-1 text-xs text-muted">{messages.books.hint}</p>

        {books.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{messages.books.empty}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {books.map((book) => (
              <li
                key={book.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line px-3 py-2"
                data-testid="sl-book-row"
              >
                {renamingId === book.id ? (
                  <input
                    className="sl-input min-w-0 flex-1"
                    value={renameText}
                    aria-label={messages.books.renameLabel.replace("{title}", book.title)}
                    onChange={(event) => setRenameText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void onRename(book.id);
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{book.title}</span>
                    {book.id === project?.id ? (
                      <span className="text-xs text-muted">{messages.books.current}</span>
                    ) : null}
                  </span>
                )}
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="sl-btn-small"
                    data-testid="sl-book-open"
                    disabled={book.id === project?.id}
                    onClick={() => {
                      choose(book.id);
                      onClose();
                    }}
                  >
                    {messages.books.open}
                  </button>
                  <button
                    type="button"
                    className="sl-btn-small"
                    data-testid="sl-book-rename"
                    onClick={() => {
                      setRenamingId(book.id);
                      setRenameText(book.title);
                    }}
                  >
                    {messages.books.rename}
                  </button>
                  <button
                    type="button"
                    className="sl-btn-small sl-danger"
                    data-testid="sl-book-delete"
                    data-danger={confirmId === book.id}
                    onClick={() => void onDelete(book.id, book.title)}
                  >
                    {confirmId === book.id ? messages.books.confirmDelete : messages.books.delete}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreate();
          }}
        >
          <input
            className="sl-input flex-1"
            placeholder={messages.books.newPlaceholder}
            aria-label={messages.books.new}
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <button
            type="submit"
            className="sl-btn sl-btn-primary"
            data-testid="sl-book-create"
            disabled={newTitle.trim().length === 0 || create.isPending}
          >
            {messages.books.new}
          </button>
        </form>
      </section>
    </>
  );
}
