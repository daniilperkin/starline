import { messages } from "@starline/core";
import { useState } from "react";
import { useUndoStore } from "./undo";

/** The "Undo" toast for structural edits (scene/chapter/character deletes, scene moves). */
export function UndoToast() {
  const action = useUndoStore((state) => state.action);
  const clear = useUndoStore((state) => state.clear);
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  return (
    <div className="sl-undo-toast" role="status" aria-live="polite">
      <span className="min-w-0 flex-1 truncate text-sm">{action.label}</span>
      <button
        type="button"
        className="sl-btn-small"
        disabled={busy}
        onClick={() => {
          setBusy(true);
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
