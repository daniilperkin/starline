import { messages } from "@starline/core";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./AppLayout";
import { ComingSoonScreen } from "./ComingSoonScreen";
import { PlanScreen } from "./PlanScreen";
import { StepScreen } from "./StepScreen";

const rootRoute = createRootRoute({ component: AppLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/plan" });
  },
});

const planRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plan",
  component: PlanScreen,
});

const stepRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plan/step/$step",
  component: StepScreen,
});

const scenesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scenes",
  component: () => <ComingSoonScreen label={messages.tabs.scenes} />,
});

const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people",
  component: () => <ComingSoonScreen label={messages.tabs.people} />,
});

const worldRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/world",
  component: () => <ComingSoonScreen label={messages.tabs.world} />,
});

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  component: () => <ComingSoonScreen label={messages.tabs.notes} />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  planRoute,
  stepRoute,
  scenesRoute,
  peopleRoute,
  worldRoute,
  notesRoute,
]);

/**
 * Hash history: identical behaviour in the PWA, the Capacitor WebView and file:// previews,
 * with no server rewrite rules (deep links are not a v1 goal).
 */
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
