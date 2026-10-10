/**
 * Attachments in the UI (PLAN slice 14): a character's gallery, a single-image slot for entities
 * that have one (lore entry, project cover) and the viewer. Files are added by picker, drag or
 * paste; the tile shows the stored 256 px thumbnail and the viewer reads the full bytes.
 */
import { type GalleryItem, type ImageSlotTarget, messages, type UUID } from "@starline/core";
import type { TauriStorageDriver } from "@starline/driver-wasm";
import { useRef, useState } from "react";
import { AttachmentError, formatBytes, ingestFiles, useAttachmentUrl } from "./attachments";
import {
  useAttachToGallery,
  useCharacterGallery,
  useDeleteAttachment,
  useDetachFromGallery,
  useSetEntityImage,
} from "./data";
import { useSessionStore } from "./session";

function Tile({
  item,
  driver,
  onOpen,
  onRemove,
}: {
  item: GalleryItem;
  driver: TauriStorageDriver | null;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const thumb = useAttachmentUrl(driver ?? null, item.id, { thumb: true });
  const isPdf = item.mimeType === "application/pdf";
  return (
    <li className="sl-gallery-tile" data-testid={`sl-attachment-${item.id}`}>
      <button
        type="button"
        className="sl-gallery-thumb"
        onClick={onOpen}
        aria-label={item.fileName}
      >
        {thumb !== null ? (
          <img src={thumb} alt={item.caption || item.fileName} />
        ) : (
          <span className="sl-gallery-glyph">{isPdf ? messages.attachments.pdf : "✦"}</span>
        )}
      </button>
      <div className="sl-gallery-caption">
        <span className="sl-gallery-name" title={item.fileName}>
          {item.caption.trim() || item.fileName}
        </span>
        <span className="text-xs text-muted">{formatBytes(item.byteSize)}</span>
      </div>
      <button
        type="button"
        className="sl-btn sl-btn-small sl-gallery-remove"
        aria-label={messages.attachments.remove}
        onClick={onRemove}
      >
        ✕
      </button>
    </li>
  );
}

/** Full-size viewer: images render, PDFs open in the system browser (the app never fetches them). */
export function AttachmentViewer({
  attachment,
  onClose,
  onDelete,
}: {
  attachment: GalleryItem;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const session = useSessionStore((state) => state.session);
  const url = useAttachmentUrl(session?.driver ?? null, attachment.id);
  const isPdf = attachment.mimeType === "application/pdf";
  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.common.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet sl-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={messages.attachments.viewer}
      >
        <header className="sl-sheet-head">
          <h2 className="sl-sheet-title">{attachment.caption.trim() || attachment.fileName}</h2>
          <button
            type="button"
            className="sl-btn sl-btn-small"
            aria-label={messages.common.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="sl-viewer-body" data-testid="sl-viewer-body">
          {isPdf ? (
            <p className="sl-gallery-glyph sl-gallery-glyph-big">{messages.attachments.pdf}</p>
          ) : url !== null ? (
            <img src={url} alt={attachment.fileName} />
          ) : (
            <p className="text-sm text-muted">{messages.common.loading}</p>
          )}
        </div>
        <footer className="sl-sheet-foot">
          <span className="text-xs text-muted">
            {attachment.fileName} · {formatBytes(attachment.byteSize)}
          </span>
          {url !== null ? (
            <a className="sl-btn" href={url} download={attachment.fileName} rel="noopener">
              {messages.attachments.open}
            </a>
          ) : null}
          {onDelete !== undefined ? (
            <button type="button" className="sl-btn" data-danger="true" onClick={onDelete}>
              {messages.attachments.deleteFile}
            </button>
          ) : null}
        </footer>
      </section>
    </>
  );
}

/**
 * A character's gallery: tiles in order, captions edited in place, files added by picker, drag or
 * paste. Same bytes added twice dedupe to one attachment (the row is reused, the tile is not).
 */
export function CharacterGallery({
  projectId,
  characterId,
}: {
  projectId: UUID;
  characterId: UUID;
}) {
  const session = useSessionStore((state) => state.session);
  const gallery = useCharacterGallery(characterId);
  const attach = useAttachToGallery();
  const detach = useDetachFromGallery();
  const remove = useDeleteAttachment();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<GalleryItem | null>(null);
  const [dragging, setDragging] = useState(false);

  const items = gallery.data ?? [];

  const onFiles = async (files: readonly File[]) => {
    if (session === null || files.length === 0) return;
    setError(null);
    for (const file of files) {
      setBusy(messages.attachments.uploading.replace("{name}", file.name));
      try {
        const outcomes = await ingestFiles(session.driver, projectId, [file]);
        for (const outcome of outcomes) {
          await attach.mutateAsync({ projectId, characterId, attachmentId: outcome.attachmentId });
        }
      } catch (cause) {
        setError(
          cause instanceof AttachmentError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
      }
    }
    setBusy(null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag/paste are pointer extras; the Add button is the keyboard path.
    <section
      className={`sl-gallery${dragging ? " sl-gallery-drop" : ""}`}
      data-testid="sl-gallery"
      tabIndex={-1}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void onFiles([...event.dataTransfer.files]);
      }}
      onPaste={(event) => {
        const files = [...event.clipboardData.files];
        if (files.length > 0) {
          event.preventDefault();
          void onFiles(files);
        }
      }}
    >
      <header className="sl-gallery-head">
        <h2 className="sl-section-title">{messages.attachments.gallery}</h2>
        <button
          type="button"
          className="sl-btn"
          data-testid="sl-gallery-add"
          onClick={() => inputRef.current?.click()}
        >
          {messages.attachments.add}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          multiple
          hidden
          data-testid="sl-gallery-input"
          onChange={(event) => {
            void onFiles([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </header>
      {busy !== null ? <p className="text-xs text-muted">{busy}</p> : null}
      {error !== null ? <p className="sl-error">{error}</p> : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted" data-testid="sl-gallery-empty">
          {messages.attachments.empty} {messages.attachments.dropHint}
        </p>
      ) : (
        <ul className="sl-gallery-grid">
          {items.map((item) => (
            <Tile
              key={item.id}
              item={item}
              driver={session?.driver ?? null}
              onOpen={() => setViewer(item)}
              onRemove={() =>
                void detach.mutateAsync({ projectId, characterId, attachmentId: item.id })
              }
            />
          ))}
        </ul>
      )}
      {viewer !== null ? (
        <AttachmentViewer
          attachment={viewer}
          onClose={() => setViewer(null)}
          onDelete={() => {
            void remove.mutateAsync({ projectId, attachmentId: viewer.id });
            setViewer(null);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * The single-image slot: lore entries and the project cover. One image, set or cleared — the
 * gallery is for characters, this is the "one picture that represents it" case.
 */
export function ImageSlot({
  projectId,
  target,
  entityId,
  current,
  label,
}: {
  projectId: UUID;
  target: ImageSlotTarget;
  entityId: UUID;
  current: UUID | null;
  label?: string;
}) {
  const session = useSessionStore((state) => state.session);
  const setImage = useSetEntityImage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const url = useAttachmentUrl(session?.driver ?? null, current, { thumb: true });
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="sl-image-slot" data-testid="sl-image-slot">
      <span className="sl-label">{label ?? messages.attachments.imageLabel}</span>
      <div className="sl-image-slot-body">
        {url !== null ? (
          <img className="sl-image-slot-thumb" src={url} alt="" />
        ) : (
          <span className="sl-image-slot-empty">✦</span>
        )}
        <div className="sl-image-slot-actions">
          <button
            type="button"
            className="sl-btn"
            data-testid="sl-image-slot-set"
            onClick={() => inputRef.current?.click()}
          >
            {messages.attachments.setImage}
          </button>
          {current !== null ? (
            <button
              type="button"
              className="sl-btn"
              data-testid="sl-image-slot-clear"
              onClick={() =>
                void setImage.mutateAsync({ projectId, target, entityId, attachmentId: null })
              }
            >
              {messages.attachments.clearImage}
            </button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          data-testid="sl-image-slot-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file === undefined || session === null) return;
            setError(null);
            void ingestFiles(session.driver, projectId, [file])
              .then(async (outcomes) => {
                const first = outcomes[0];
                if (first === undefined) return;
                await setImage.mutateAsync({
                  projectId,
                  target,
                  entityId,
                  attachmentId: first.attachmentId,
                });
              })
              .catch((cause: unknown) => {
                setError(
                  cause instanceof AttachmentError
                    ? cause.message
                    : cause instanceof Error
                      ? cause.message
                      : String(cause),
                );
              });
          }}
        />
      </div>
      {error !== null ? <p className="sl-error">{error}</p> : null}
    </section>
  );
}
