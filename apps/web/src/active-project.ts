import type { ProjectSummary, UUID } from "@starline/core";
import { create } from "zustand";
import { useProjects } from "./data";

/**
 * Which book is open (slice 23). A `.starline` library has always been able to hold many books —
 * the schema, the interchange and the export all handle it — but every screen read
 * `projects[0]`, so in practice the second book was invisible. This store holds the choice; the
 * hook falls back to the first book whenever nothing is chosen or the chosen one disappeared, so
 * nothing that worked before can break.
 *
 * The choice is device state, not library state: which book you had open on this phone is not part
 * of the novel, exactly like the interface language and the writing typography.
 */

const ACTIVE_KEY = "starline.activeProject";

function readStored(): UUID | null {
  try {
    const value = localStorage.getItem(ACTIVE_KEY);
    return value === null || value.length === 0 ? null : (value as UUID);
  } catch {
    return null;
  }
}

interface ActiveProjectState {
  id: UUID | null;
  choose: (id: UUID | null) => void;
}

export const useActiveProjectStore = create<ActiveProjectState>()((set) => ({
  id: readStored(),
  choose: (id) => {
    try {
      if (id === null) localStorage.removeItem(ACTIVE_KEY);
      else localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      // Private mode: the choice lasts for this session only.
    }
    set({ id });
  },
}));

export interface ActiveProject {
  /** The chosen book, the first book, or null when the library has none yet. */
  project: ProjectSummary | null;
  /** Every book in this library, in the order the query returns them. */
  books: ProjectSummary[];
  choose: (id: UUID | null) => void;
}

/** The one place a screen asks "which book am I looking at?". */
export function useActiveProject(): ActiveProject {
  const projects = useProjects();
  const chosen = useActiveProjectStore((state) => state.id);
  const choose = useActiveProjectStore((state) => state.choose);
  const books = projects.data ?? [];
  const project = books.find((book) => book.id === chosen) ?? books[0] ?? null;
  return { project, books, choose };
}

/** Test seam: the key the choice is stored under. */
export const ACTIVE_PROJECT_KEY = ACTIVE_KEY;
