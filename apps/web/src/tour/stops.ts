/**
 * The guided tour's stops (slice 26, decision 26b).
 *
 * A stop is a route, an optional anchor on that route, and a placement. The words live in the
 * i18n catalogue (`messages.tour.stops.<id>.title` / `.body`), so the tour speaks the writer's
 * language like everything else — which is why the ids here and the catalogue keys must match
 * exactly; a test holds them together.
 *
 * Anchors are CSS selectors rather than component references: the tour spans screens it does not
 * own, and a selector is the one thing every screen already has. A stop whose anchor is missing
 * (a hidden control, a different layout) still shows, centred, rather than breaking the tour —
 * the words are the point, the spotlight is the courtesy.
 */

export const TOUR_STOP_IDS = [
  "welcome",
  "plan",
  "search",
  "books",
  "settings",
  "backups",
  "export",
  "daily",
  "write",
  "scenes",
  "scenesViews",
  "people",
  "world",
  "notes",
  "end",
] as const;

export type TourStopId = (typeof TOUR_STOP_IDS)[number];

export type TourPlacement = "top" | "bottom" | "center";

export interface TourStop {
  id: TourStopId;
  /** Where the app must be for this stop to make sense. */
  route: string;
  /** The element to spotlight; `null` shows a centred card with no spotlight. */
  target: string | null;
  placement: TourPlacement;
}

export const TOUR_STOPS: readonly TourStop[] = [
  { id: "welcome", route: "/plan", target: null, placement: "center" },
  { id: "plan", route: "/plan", target: '[data-testid="sl-step-row"]', placement: "bottom" },
  { id: "search", route: "/plan", target: '[data-testid="sl-search-open"]', placement: "bottom" },
  { id: "books", route: "/plan", target: '[data-testid="sl-book-switcher"]', placement: "bottom" },
  { id: "settings", route: "/plan", target: '[data-testid="sl-open-settings"]', placement: "top" },
  { id: "backups", route: "/plan", target: '[data-testid="sl-open-backups"]', placement: "top" },
  { id: "export", route: "/plan", target: '[data-testid="sl-open-export"]', placement: "top" },
  { id: "daily", route: "/plan", target: '[data-testid="sl-daily-question"]', placement: "bottom" },
  { id: "write", route: "/plan", target: '[data-testid="sl-continue-write"]', placement: "top" },
  {
    id: "scenes",
    route: "/scenes",
    target: '[data-testid="sl-scenes-count"]',
    placement: "bottom",
  },
  {
    id: "scenesViews",
    route: "/scenes",
    target: '[data-testid="sl-scenes-board"]',
    placement: "bottom",
  },
  { id: "people", route: "/people", target: null, placement: "center" },
  { id: "world", route: "/world", target: null, placement: "center" },
  { id: "notes", route: "/notes", target: '[data-testid="sl-notes-board"]', placement: "bottom" },
  { id: "end", route: "/plan", target: null, placement: "center" },
] as const;
