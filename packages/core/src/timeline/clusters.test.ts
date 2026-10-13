import { describe, expect, it } from "vitest";
import { clusterTimelineItems } from "./clusters";

const item = (id: string, storyTime: number) => ({ id, storyTime });

const YEAR = { start: 0, end: 31_536_000 };

describe("clusterTimelineItems", () => {
  it("keeps distant events separate at any zoom", () => {
    const items = [item("a", 0), item("b", 10_000_000), item("c", 20_000_000)];
    const clusters = clusterTimelineItems(items, YEAR, 0.05);
    expect(clusters.length).toBe(3);
    expect(clusters.every((cluster) => cluster.items.length === 1)).toBe(true);
  });

  it("clusters events that a year-wide view cannot tell apart", () => {
    // three events inside one day, viewed across a year: 0.3% of the window
    const items = [item("a", 0), item("b", 3600), item("c", 7200)];
    const clusters = clusterTimelineItems(items, YEAR, 0.05);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(clusters[0]?.storyTime).toBe(0);
  });

  it("splits the same events once the window narrows — the point of the feature", () => {
    const items = [item("a", 0), item("b", 3600), item("c", 7200)];
    // a day-wide window with a 1% threshold is 864 seconds: the events are an hour apart
    const day = { start: 0, end: 86_400 };
    const clusters = clusterTimelineItems(items, day, 0.01);
    expect(clusters.length).toBe(3);
  });

  it("keeps a run of close events in one chip rather than a staircase of pairs", () => {
    const step = 500_000;
    const items = [item("a", 0), item("b", step), item("c", step * 2), item("d", step * 3)];
    const clusters = clusterTimelineItems(items, YEAR, 0.05);
    expect(clusters.length).toBe(1);
    expect(clusters[0]?.items.length).toBe(4);
  });

  it("measures from the cluster's anchor, so a long run splits instead of swallowing the lane", () => {
    // Each step is under the threshold, but the run spans well over it: the chip covers at most
    // one threshold's worth of time, which is what keeps a busy month readable.
    const step = 1_000_000;
    const items = [item("a", 0), item("b", step), item("c", step * 2), item("d", step * 3)];
    const clusters = clusterTimelineItems(items, YEAR, 0.05);
    expect(clusters.length).toBe(2);
    expect(clusters[0]?.items.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(clusters[1]?.items.map((entry) => entry.id)).toEqual(["c", "d"]);
  });

  it("is stable regardless of input order, and orders items by time", () => {
    const items = [item("c", 7200), item("a", 0), item("b", 3600)];
    const clusters = clusterTimelineItems(items, YEAR, 0.05);
    expect(clusters[0]?.items.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for no items and singles for one", () => {
    expect(clusterTimelineItems([], YEAR, 0.05)).toEqual([]);
    const one = clusterTimelineItems([item("a", 5)], YEAR, 0.05);
    expect(one.length).toBe(1);
    expect(one[0]?.items.length).toBe(1);
  });

  it("survives a degenerate window without dividing by zero", () => {
    const items = [item("a", 10), item("b", 20)];
    const clusters = clusterTimelineItems(items, { start: 10, end: 10 }, 0.05);
    // span clamps to 1 second, so events 10 s apart stay separate
    expect(clusters.length).toBe(2);
  });
});
