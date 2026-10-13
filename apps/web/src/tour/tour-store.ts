import { create } from "zustand";

/**
 * Whether the tour has been seen, remembered per device — the same class of state as the locale
 * and the active book, and for the same reason: it says nothing about the writer's story, so it
 * does not belong in the library file.
 *
 * One key covers both the tour itself and the first-run offer: taking the tour, finishing it,
 * skipping it, or dismissing the offer all mean "seen". A writer who wants it again finds the
 * button on the start screen and in Settings.
 */
const TOUR_KEY = "starline.tour";

function readSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) !== null;
  } catch {
    // Private mode: no storage. Treat as seen so the offer does not reappear every reload.
    return true;
  }
}

function markSeen(value: "done" | "dismissed"): void {
  try {
    localStorage.setItem(TOUR_KEY, value);
  } catch {
    // Private mode: the choice lasts the session only.
  }
}

interface TourState {
  running: boolean;
  /** The one-time offer card, shown on the start screen until it is taken or dismissed. */
  offered: boolean;
  start: () => void;
  stop: () => void;
  dismissOffer: () => void;
}

export const useTourStore = create<TourState>()((set) => ({
  running: false,
  offered: !readSeen(),
  start: () => set({ running: true, offered: false }),
  stop: () => {
    markSeen("done");
    set({ running: false });
  },
  dismissOffer: () => {
    markSeen("dismissed");
    set({ offered: false });
  },
}));
