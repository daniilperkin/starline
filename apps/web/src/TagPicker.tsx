import { type EntityType, messages, type UUID } from "@starline/core";
import { useState } from "react";

import { useCreateTag, useEntityTags, useTags, useToggleEntityTag } from "./data";

/**
 * Chips plus a popup picker, shared by the scene sheet, the character dossier and the lore
 * sheet (spec §4.3.4 "Tags", §4.2.2 dossier). Tapping a chip detaches; the popup toggles, and
 * a name typed there creates the tag and attaches it in one go.
 */
export function TagPicker({
  projectId,
  entityType,
  entityId,
  className = "",
}: {
  projectId: UUID;
  entityType: EntityType;
  entityId: UUID;
  className?: string;
}) {
  const tags = useTags(projectId);
  const attached = useEntityTags(entityType, entityId);
  const toggle = useToggleEntityTag();
  const createTag = useCreateTag();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const attachedIds = new Set((attached.data ?? []).map((tag) => tag.id));
  const error = toggle.error ?? createTag.error;

  return (
    <div className={`sl-tag-picker ${className}`}>
      <div className="sl-tag-chips">
        {(attached.data ?? []).map((tag) => (
          <button
            key={tag.id}
            type="button"
            className="sl-chip"
            data-testid="sl-tag-chip"
            aria-label={messages.tags.detach.replace("{name}", tag.name)}
            onClick={() =>
              toggle.mutate({ projectId, entityType, entityId, tagId: tag.id, attach: false })
            }
          >
            <span className="sl-dot" style={{ background: tag.color }} aria-hidden="true" />
            {tag.name}
          </button>
        ))}
        <button
          type="button"
          className="sl-chip sl-chip-add"
          aria-expanded={open}
          data-testid="sl-tag-open"
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">＋</span> {messages.tags.picker}
        </button>
      </div>

      {open ? (
        <div className="sl-tag-popup" data-testid="sl-tag-popup">
          {(tags.data ?? []).length === 0 ? (
            <p className="text-xs text-muted">{messages.tags.pickerEmpty}</p>
          ) : (
            <div className="sl-tag-options">
              {(tags.data ?? []).map((tag) => (
                <label key={tag.id} className="sl-tag-option">
                  <input
                    type="checkbox"
                    checked={attachedIds.has(tag.id)}
                    data-testid="sl-tag-toggle"
                    onChange={(event) =>
                      toggle.mutate({
                        projectId,
                        entityType,
                        entityId,
                        tagId: tag.id,
                        attach: event.target.checked,
                      })
                    }
                  />
                  <span className="sl-dot" style={{ background: tag.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              className="sl-input min-w-0 flex-1"
              value={draft}
              placeholder={messages.tags.newTagPlaceholder}
              aria-label={messages.tags.namePlaceholder}
              data-testid="sl-tag-new"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const name = draft.trim();
                if (name.length === 0) return;
                createTag.mutate(
                  { projectId, name },
                  {
                    onSuccess: ({ tagId }) => {
                      toggle.mutate({ projectId, entityType, entityId, tagId, attach: true });
                      setDraft("");
                    },
                  },
                );
              }}
            />
            <button
              type="button"
              className="sl-btn"
              data-testid="sl-tag-create"
              disabled={draft.trim().length === 0 || createTag.isPending}
              onClick={() => {
                const name = draft.trim();
                if (name.length === 0) return;
                createTag.mutate(
                  { projectId, name },
                  {
                    onSuccess: ({ tagId }) => {
                      toggle.mutate({ projectId, entityType, entityId, tagId, attach: true });
                      setDraft("");
                    },
                  },
                );
              }}
            >
              {messages.tags.create}
            </button>
          </div>
          {error ? <p className="sl-error">{error.message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
