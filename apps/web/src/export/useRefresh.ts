import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * The importers write through ordinary commands, which publish on the change bus; this hook is the
 * belt-and-braces refresh for the screens that read aggregates (scene lists, dashboard, timeline,
 * search) so a freshly imported batch appears without a manual reload.
 */
export function useScenesRefresh(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    for (const key of [
      "scenes",
      "dashboard",
      "timeline",
      "chapters",
      "plotlines",
      "characters",
      "lore",
      "trash",
      "export-data",
      "search",
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [queryClient]);
}
