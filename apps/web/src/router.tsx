import { messages } from "@starline/core";
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { AppLayout } from "./AppLayout";
import { ComingSoonScreen } from "./ComingSoonScreen";
import { PlanScreen } from "./PlanScreen";
import { StepScreen } from "./StepScreen";

/**
 * Routes are code-split per screen (`lazyRouteComponent`): the shell, the start screen and the
 * plan dashboard stay in the first chunk, every other tab arrives when it is opened. The bundle
 * gate (spec §5.1) flagged the single chunk as TIGHT after slice 7, and slice 8 adds the
 * relationship matrix and graph on top — this is the split the gate asked for.
 */
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
  component: lazyRouteComponent(() => import("./ScenesScreen"), "ScenesScreen"),
});

const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trash",
  component: lazyRouteComponent(() => import("./TrashScreen"), "TrashScreen"),
});

const peopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people",
  component: lazyRouteComponent(() => import("./PeopleScreen"), "PeopleScreen"),
});

const characterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people/$characterId",
  component: lazyRouteComponent(() => import("./CharacterScreen"), "CharacterScreen"),
});

const worldRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/world",
  component: lazyRouteComponent(() => import("./WorldScreen"), "WorldScreen"),
});

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  component: () => <ComingSoonScreen label={messages.tabs.notes} />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("./SettingsScreen"), "SettingsScreen"),
});

const backupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/backups",
  component: lazyRouteComponent(() => import("./BackupsScreen"), "BackupsScreen"),
});

const checksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/checks",
  component: lazyRouteComponent(() => import("./ChecksScreen"), "ChecksScreen"),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  planRoute,
  stepRoute,
  scenesRoute,
  trashRoute,
  peopleRoute,
  characterRoute,
  worldRoute,
  notesRoute,
  checksRoute,
  backupsRoute,
  settingsRoute,
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
