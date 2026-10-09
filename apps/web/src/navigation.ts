import type { UUID } from "@starline/core";
import { create } from "zustand";

/**
 * Cross-screen navigation intent (ephemeral UI state, spec §2.3.1: Zustand holds only what the
 * database does not). A backlink row, a search hit or a check item points at an entity that
 * lives behind a sheet inside another tab; the tab screen consumes the intent on mount and
 * opens its sheet, so the target never has to be encoded into the hash route.
 */
export interface OpenTarget {
  kind: "scene" | "lore";
  id: UUID;
}

interface NavigationState {
  target: OpenTarget | null;
  open: (target: OpenTarget) => void;
  clear: () => void;
}

export const useNavigationStore = create<NavigationState>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  clear: () => set({ target: null }),
}));
