import { format, messages, type TrashEntityType, type UUID } from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useEmptyTrash, useProjects, useRestoreEntity, useTrash } from "./data";
import { relativeTime } from "./time";

/**
 * Trash (spec §3.9 / §5.3): everything soft-deleted, newest first, restorable with one tap.
 * Rows leave the trash 30 days after deletion (purged on open); "Empty trash" is two-tap.
 */
export function TrashScreen() {
  const navigate = useNavigate();
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;
  const trash = useTrash(project?.id ?? null);
  const restore = useRestoreEntity();
  const empty = useEmptyTrash();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const items = trash.data ?? [];

  const onRestore = async (entityType: TrashEntityType, entityId: UUID) => {
    if (project === null) return;
    setRestoringId(entityId);
    try {
      await restore.mutateAsync({ projectId: project.id, entityType, entityId });
    } finally {
      setRestoringId(null);
    }
  };

  const onEmpty = () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      window.setTimeout(() => setConfirmEmpty(false), 2500);
      return;
    }
    if (project !== null) empty.mutate({ projectId: project.id });
    setConfirmEmpty(false);
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          className="sl-btn"
          aria-label={messages.plan.previous}
          onClick={() => void navigate({ to: "/plan" })}
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {messages.trash.heading}
          </h1>
          <p className="text-xs text-muted">{messages.trash.purgeNote}</p>
        </div>
        {items.length > 0 ? (
          <button
            type="button"
            className="sl-btn-small shrink-0"
            disabled={empty.isPending}
            onClick={onEmpty}
          >
            {confirmEmpty ? messages.trash.emptyConfirm : messages.trash.emptyTrash}
          </button>
        ) : null}
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-muted">{messages.trash.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={`${item.entityType}:${item.entityId}`}
              className="sl-card flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {messages.trash.types[item.entityType as keyof typeof messages.trash.types] ??
                    item.entityType}
                  {item.detail.length > 0 ? ` · ${item.detail}` : ""} ·{" "}
                  {format(messages.trash.deletedAt, { when: relativeTime(item.deletedAt) })}
                </p>
              </div>
              <button
                type="button"
                className="sl-btn-small shrink-0"
                disabled={restoringId === item.entityId}
                onClick={() => void onRestore(item.entityType as TrashEntityType, item.entityId)}
              >
                {messages.trash.restore}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
