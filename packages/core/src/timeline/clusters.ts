/**
 * Timeline clustering (slice 24, the documented v1 overlap).
 *
 * At a wide zoom a lane's events land on top of each other: the view positions each item at a
 * fraction of the canvas, and at the years zoom a busy week is a few pixels wide. The v1 renderer
 * nudged overlapping blocks sideways, which reads as noise once three or more collide. Clustering
 * replaces the nudge: events closer together than a threshold become one chip that says how many
 * there are, and the writer taps it to see them.
 *
 * The threshold is expressed as a fraction of the visible window, so the same events cluster at the
 * years zoom and stay separate at the days zoom — which is the whole point of the feature.
 */

export interface TimelineWindowLike {
  start: number;
  end: number;
}

export interface TimelineCluster<T> {
  /** Stable key: the first item's story time, which is what the chip is anchored to. */
  key: string;
  /** The earliest story time in the cluster — where the chip is drawn. */
  storyTime: number;
  items: T[];
}

/**
 * Groups items whose story times are closer than `minFraction` of the visible window.
 * Items are returned in time order; a cluster of one is just that item.
 */
export function clusterTimelineItems<T extends { id: string; storyTime: number }>(
  items: readonly T[],
  window: TimelineWindowLike,
  minFraction: number,
): TimelineCluster<T>[] {
  const span = Math.max(1, window.end - window.start);
  const threshold = span * Math.max(0, minFraction);
  const sorted = [...items].sort((a, b) => a.storyTime - b.storyTime || a.id.localeCompare(b.id));
  const clusters: TimelineCluster<T>[] = [];
  let current: TimelineCluster<T> | null = null;

  for (const item of sorted) {
    if (current === null) {
      current = { key: `${item.id}`, storyTime: item.storyTime, items: [item] };
      continue;
    }
    // Measure from the cluster's anchor, not from the previous item, so a chain of close events
    // becomes one chip rather than a staircase of pairs.
    if (item.storyTime - current.storyTime < threshold) {
      current.items.push(item);
      continue;
    }
    clusters.push(current);
    current = { key: `${item.id}`, storyTime: item.storyTime, items: [item] };
  }
  if (current !== null) clusters.push(current);
  return clusters;
}
