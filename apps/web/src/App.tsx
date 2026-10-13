import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "./data";
import { router } from "./router";
import { Starfield } from "./Starfield";
import { StartScreen } from "./StartScreen";
import { useSessionStore } from "./session";
import { TourOverlay } from "./tour/TourOverlay";
import { useTourStore } from "./tour/tour-store";

export function App() {
  const session = useSessionStore((state) => state.session);
  const setSession = useSessionStore((state) => state.setSession);
  const tourRunning = useTourStore((state) => state.running);
  const stopTour = useTourStore((state) => state.stop);

  return (
    <div className="relative min-h-dvh bg-canvas text-ink">
      <Starfield />
      <div className="sl-shell relative z-10">
        {session ? (
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        ) : (
          <StartScreen onOpen={setSession} />
        )}
      </div>
      {tourRunning ? <TourOverlay onDone={stopTour} /> : null}
    </div>
  );
}
