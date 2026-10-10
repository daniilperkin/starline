import { describe, expect, it } from "vitest";

import { DAY_MS, DEFAULT_RETENTION, HOUR_MS, planRetention, type SnapshotFile } from "./index";

/** Retention thinning (spec §4.5.3) — pure, so every rule is checked directly. */

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

function file(
  name: string,
  ageMs: number,
  reason: SnapshotFile["reason"] = "activity",
  byteSize = 1000,
): SnapshotFile {
  return { name, createdAt: NOW - ageMs, byteSize, reason, label: "" };
}

describe("planRetention", () => {
  it("keeps everything from the last 24 hours", () => {
    const files = [file("a", 1 * HOUR_MS), file("b", 5 * HOUR_MS), file("c", 23 * HOUR_MS)];
    const plan = planRetention(files, NOW);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toHaveLength(3);
  });

  it("keeps the newest of each hour between 24 hours and 7 days", () => {
    // NOW is 12:00, so 24 h 10 m ago is 11:50 and 24 h 20 m ago is 11:40 — same hour.
    const files = [
      file("hour-11-newest", 24 * HOUR_MS + 10 * 60 * 1000),
      file("hour-11-older", 24 * HOUR_MS + 20 * 60 * 1000),
      file("hour-10", 25 * HOUR_MS + 30 * 60 * 1000),
      file("three-days", 3 * DAY_MS),
    ];
    const plan = planRetention(files, NOW);
    expect(plan.remove).toEqual(["hour-11-older"]);
    expect(plan.keep).toContain("hour-10");
    expect(plan.keep).toContain("three-days");
  });

  it("keeps the newest of each day between 7 and 60 days", () => {
    const files = [
      file("day-10-newest", 10 * DAY_MS),
      file("day-10-older", 10 * DAY_MS + 6 * HOUR_MS),
      file("day-11", 11 * DAY_MS),
      file("day-59", 59 * DAY_MS),
    ];
    const plan = planRetention(files, NOW);
    expect(plan.remove).toEqual(["day-10-older"]);
    expect(plan.keep).toContain("day-11");
    expect(plan.keep).toContain("day-59");
  });

  it("drops anything older than 60 days", () => {
    const files = [
      file("recent", 2 * DAY_MS),
      file("ancient", 61 * DAY_MS),
      file("older", 90 * DAY_MS),
    ];
    const plan = planRetention(files, NOW);
    expect(plan.remove.sort()).toEqual(["ancient", "older"]);
  });

  it("never thins a manual or pre_* snapshot, however old", () => {
    const files = [
      file("manual", 400 * DAY_MS, "manual"),
      file("pre-import", 200 * DAY_MS, "pre_import"),
      file("pre-migration", 300 * DAY_MS, "pre_migration"),
      file("pre-restore", 100 * DAY_MS, "pre_restore"),
      file("pre-bulk", 150 * DAY_MS, "pre_bulk_delete"),
      file("plain", 400 * DAY_MS),
    ];
    const plan = planRetention(files, NOW);
    expect(plan.remove).toEqual(["plain"]);
  });

  it("never removes the newest snapshot, even when it is the only thing over the cap", () => {
    const files = [
      file("newest", 1 * DAY_MS, "activity", 3 * 1024 * 1024 * 1024),
      file("older", 2 * DAY_MS, "activity", 10),
    ];
    const plan = planRetention(files, NOW);
    expect(plan.keep).toContain("newest");
    expect(plan.keepBytes).toBeGreaterThan(DEFAULT_RETENTION.totalBytesCap);
  });

  it("thins oldest-first when the byte cap is exceeded", () => {
    const big = 600 * 1024 * 1024;
    const files = [
      file("newest", 1 * HOUR_MS, "activity", big),
      file("middle", 2 * HOUR_MS, "activity", big),
      file("oldest", 3 * HOUR_MS, "activity", big),
      file("manual", 4 * HOUR_MS, "manual", big),
    ];
    const plan = planRetention(files, NOW);
    // 2.4 GB kept against a 2 GB cap: the oldest non-pinned file goes, the manual one stays.
    expect(plan.remove).toEqual(["oldest"]);
    expect(plan.keep).toContain("manual");
    expect(plan.keepBytes).toBeLessThanOrEqual(DEFAULT_RETENTION.totalBytesCap);
  });

  it("handles an empty store", () => {
    expect(planRetention([], NOW)).toEqual({ keep: [], remove: [], keepBytes: 0 });
  });

  it("respects a custom policy", () => {
    const files = [file("a", 2 * DAY_MS), file("b", 3 * DAY_MS)];
    const plan = planRetention(files, NOW, {
      keepAllMs: 4 * DAY_MS,
      hourlyMs: 5 * DAY_MS,
      dailyMs: 6 * DAY_MS,
      totalBytesCap: 10_000,
    });
    expect(plan.remove).toEqual([]);
  });
});
