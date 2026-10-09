import { messages } from "@starline/core";
import { useState } from "react";
import { useUndoStore } from "./undo";

/** The "Undo" toast for structural edits (scene/chapter/character deletes, scene moves). */
export function UndoToast() {
  const action = useUndoStore((state) => state.action);
  const clear = useUndoStore((state) => state.clear);
  // Keyed by action id: a plain boolean would stay true after the first undo (this component
  // outlives the toast) and disable the button for every later toast in the session.
  const [busyId, setBusyId] = useState<number | null>(null);
  if (!action) return null;
  const busy = busyId === action.id;
  return (
    <div className="sl-undo-toast" role="status" aria-live="polite">
      <span className="min-w-0 flex-1 truncate text-sm">{action.label}</span>
      <button
        type="button"
        className="sl-btn-small"
        disabled={busy}
        onClick={() => {
          setBusyId(action.id);
          void action
            .undo()
            .catch(() => undefined)
            .finally(() => clear());
        }}
      >
        {messages.undo.action}
      </button>
    </div>
  );
}
