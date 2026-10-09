import { describe, expect, it } from "vitest";

import { DEFAULT_TIMELINE_CALENDAR, type TimelineCalendar } from "../settings";
import {
  calendarShape,
  formatStoryTimeFull,
  formatTick,
  parseCalendar,
  parseStoryTimeInput,
  positionFraction,
  storyDateOf,
  timelineTicks,
  timelineWindow,
  zoomById,
} from "./index";
import { DAY, HOUR, TIMELINE_ZOOMS } from "./types";

/** Pure timeline maths: the calendar, the zoom levels and the tick/date formatting. */

const CUSTOM: TimelineCalendar = {
  kind: "custom",
  eraLabel: "TA",
  monthNames: ["Frost", "Thaw", "Sun", "Harvest"],
  daysPerMonth: [30, 30, 30, 30],
  hoursPerDay: 20,
};

describe("calendar shape", () => {
  it("uses Earth's months when the project is Gregorian", () => {
    const shape = calendarShape(DEFAULT_TIMELINE_CALENDAR);
    expect(shape.monthNames).toHaveLength(12);
    expect(shape.daysPerMonth).toHaveLength(12);
    expect(shape.hoursPerDay).toBe(24);
  });

  it("uses the project's own months and day lengths when custom", () => {
    const shape = calendarShape(CUSTOM);
    expect(shape.monthNames).toEqual(["Frost", "Thaw", "Sun", "Harvest"]);
    expect(shape.secondsPerYear).toBe(120 * DAY);
  });
});

describe("parseStoryTimeInput", () => {
  it("accepts a bare year, a month and a full date", () => {
    const year = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "1247");
    expect(year).not.toBeNull();
    const month = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "1247-03");
    const day = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "1247-03-12");
    const at = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "1247-03-12 14:30");
    expect(month).toBeGreaterThan(year as number);
    expect(day).toBeGreaterThan(month as number);
    expect(at).toBe((day as number) + 14 * HOUR + 30 * 60);
  });

  it("puts years before the era on the negative side of the epoch", () => {
    const bce = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "-500");
    expect(bce).not.toBeNull();
    expect(bce as number).toBeLessThan(0);
    expect(parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "-500")).toBeLessThan(
      parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "-400") as number,
    );
  });

  it("round-trips through storyDateOf", () => {
    const seconds = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "1247-03-12 14:30");
    const date = storyDateOf(DEFAULT_TIMELINE_CALENDAR, seconds as number);
    expect(date).toMatchObject({ year: 1247, month: 2, day: 12, hour: 14, minute: 30 });
  });

  it("rejects nonsense and out-of-range fields", () => {
    for (const bad of ["", "  ", "spring", "1247-13", "1247-02-31", "1247-03-12 25:00"]) {
      expect(parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, bad)).toBeNull();
    }
  });

  it("honours a custom calendar's months and hours", () => {
    // The 5th month does not exist, the 4th does; 20 hours a day means 20:00 is invalid.
    expect(parseStoryTimeInput(CUSTOM, "10-05")).toBeNull();
    expect(parseStoryTimeInput(CUSTOM, "10-04-30")).not.toBeNull();
    expect(parseStoryTimeInput(CUSTOM, "10-01-01 20:00")).toBeNull();
    expect(parseStoryTimeInput(CUSTOM, "10-01-01 19:00")).not.toBeNull();
  });
});

describe("labels", () => {
  it("formats the same instant differently per zoom", () => {
    const seconds = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "1247-03-12 14:30") as number;
    expect(formatTick(DEFAULT_TIMELINE_CALENDAR, seconds, zoomById("hours"))).toBe("14:30");
    expect(formatTick(DEFAULT_TIMELINE_CALENDAR, seconds, zoomById("days"))).toBe("12 Mar");
    expect(formatTick(DEFAULT_TIMELINE_CALENDAR, seconds, zoomById("months"))).toBe("Mar 1247 AD");
    expect(formatTick(DEFAULT_TIMELINE_CALENDAR, seconds, zoomById("years"))).toBe("1247 AD");
  });

  it("writes years before the era with BCE", () => {
    const seconds = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "-500") as number;
    expect(formatTick(DEFAULT_TIMELINE_CALENDAR, seconds, zoomById("years"))).toBe("500 BCE");
  });

  it("uses the project's era label and month names", () => {
    const seconds = parseStoryTimeInput(CUSTOM, "10-02-15") as number;
    expect(formatTick(CUSTOM, seconds, zoomById("months"))).toBe("Thaw 10 TA");
    expect(formatStoryTimeFull(CUSTOM, seconds)).toContain("15 Thaw 10 TA");
  });
});

describe("ticks and window", () => {
  it("produces ordered, spaced ticks inside the window", () => {
    const seconds = parseStoryTimeInput(DEFAULT_TIMELINE_CALENDAR, "1247") as number;
    const window = { start: seconds, end: seconds + 20 * 365.2425 * DAY };
    const ticks = timelineTicks(
      DEFAULT_TIMELINE_CALENDAR,
      window.start,
      window.end,
      zoomById("years"),
    );
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThanOrEqual(40);
    for (let index = 1; index < ticks.length; index += 1) {
      expect((ticks[index] as { seconds: number }).seconds).toBeGreaterThan(
        (ticks[index - 1] as { seconds: number }).seconds,
      );
    }
    expect(ticks[0]?.label).toMatch(/AD/);
  });

  it("pads a lone item instead of gluing it to the edge", () => {
    const zoom = zoomById("days");
    const window = timelineWindow({ start: 0, end: 0 }, zoom);
    expect(window.end - window.start).toBeGreaterThanOrEqual(zoom.spanSeconds / 4);
    const fraction = positionFraction(0, window);
    expect(fraction).toBeGreaterThan(0.2);
    expect(fraction).toBeLessThan(0.8);
  });

  it("maps positions across the window", () => {
    const window = { start: 100, end: 200 };
    expect(positionFraction(100, window)).toBe(0);
    expect(positionFraction(200, window)).toBe(1);
    expect(positionFraction(150, window)).toBeCloseTo(0.5, 5);
  });

  it("falls back to years when the zoom id is unknown", () => {
    expect(zoomById("nonsense").id).toBe("years");
    expect(TIMELINE_ZOOMS).toHaveLength(8);
    expect(TIMELINE_ZOOMS[0]?.id).toBe("hours");
    expect(TIMELINE_ZOOMS[7]?.id).toBe("millennia");
  });
});

describe("parseCalendar", () => {
  it("reads the project's calendar out of its settings JSON", () => {
    const raw = JSON.stringify({ schemaVersion: 1, timelineCalendar: CUSTOM });
    expect(parseCalendar(raw).monthNames).toEqual(CUSTOM.monthNames);
  });

  it("falls back to Earth on missing or broken settings", () => {
    expect(parseCalendar(null).kind).toBe("gregorian");
    expect(parseCalendar("{not json").eraLabel).toBe("AD");
    expect(parseCalendar(JSON.stringify({ schemaVersion: 1 })).hoursPerDay).toBe(24);
  });
});
