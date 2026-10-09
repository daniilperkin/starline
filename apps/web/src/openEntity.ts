import type { UUID } from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { useNavigationStore } from "./navigation";

/**
 * One place that knows how to reach an entity from anywhere (search hit, backlink row, check
 * item). Characters and scenes/lore have their own screens or sheets; chapters open the scenes
 * tab, notes the notes tab. Screens consume the pending sheet target on mount.
 */
export function useOpenEntity(): (entityType: string, entityId: UUID | string) => void {
  const navigate = useNavigate();
  const openTarget = useNavigationStore((state) => state.open);

  return useCallback(
    (entityType: string, entityId: UUID | string) => {
      const id = entityId as UUID;
      if (entityType === "character") {
        void navigate({ to: "/people/$characterId", params: { characterId: id } });
        return;
      }
      if (entityType === "scene") {
        openTarget({ kind: "scene", id });
        void navigate({ to: "/scenes" });
        return;
      }
      if (entityType === "lore") {
        openTarget({ kind: "lore", id });
        void navigate({ to: "/world" });
        return;
      }
      if (entityType === "chapter") {
        void navigate({ to: "/scenes" });
        return;
      }
      void navigate({ to: "/notes" });
    },
    [navigate, openTarget],
  );
}
