import { create } from "zustand";

/**
 * Session undo for structural edits (spec §2.3.3 point 4, phone scope): one pending action
 * with an "Undo" toast. The inverse is always a real command (restore entity / set placement),
 * so the database stays the source of truth — nothing is kept only in memory.
 */
export interface UndoAction {
  id: number;
  label: string;
  undo: () => Promise<void>;
}

interface UndoState {
  action: UndoAction | null;
  push: (label: string, undo: () => Promise<void>) => void;
  clear: () => void;
}

const UNDO_WINDOW_MS = 8000;

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

export const useUndoStore = create<UndoState>()((set) => ({
  action: null,
  push: (label, undo) => {
    if (timer) clearTimeout(timer);
    const action: UndoAction = { id: nextId++, label, undo };
    set({ action });
    timer = setTimeout(() => {
      set((state) => (state.action?.id === action.id ? { action: null } : state));
    }, UNDO_WINDOW_MS);
  },
  clear: () => {
    if (timer) clearTimeout(timer);
    set({ action: null });
  },
}));
