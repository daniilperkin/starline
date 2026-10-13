/**
 * Move the app to a route from outside the router's context.
 *
 * The tour can run on the start screen too (there is a button there by decision 26b), and the
 * start screen is rendered *instead of* the RouterProvider — so `useRouter` is not available to
 * it. The app uses hash history, so setting the hash is the same navigation the router performs,
 * and it works in both places.
 */
export function navigateTo(route: string): void {
  const target = `#${route}`;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}
