import type { TimelineCalendar } from "../settings";
import { DEFAULT_TIMELINE_CALENDAR } from "../settings";
import { DAY, HOUR, type TimelineZoom } from "./types";

/**
 * Calendar maths for the timeline (spec §4.4.1 "zoom from hours to millennia (project
 * calendar)"). Everything is pure and works on the calendar the project stores, so a custom
 * calendar with its own month names and lengths formats correctly instead of falling back to
 * Gregorian — the app never assumes Earth.
 */

const GREGORIAN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const GREGORIAN_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface CalendarShape {
  monthNames: string[];
  daysPerMonth: number[];
  hoursPerDay: number;
  secondsPerYear: number;
}

/** Month names and lengths for a calendar, with the Earth defaults when it is Gregorian. */
export function calendarShape(calendar: TimelineCalendar): CalendarShape {
  const custom =
    calendar.kind === "custom" && calendar.monthNames !== null && calendar.daysPerMonth !== null;
  const monthNames = custom ? (calendar.monthNames as string[]) : GREGORIAN_MONTHS;
  const daysPerMonth = custom ? (calendar.daysPerMonth as number[]) : GREGORIAN_DAYS;
  const daysInYear = daysPerMonth.reduce((sum, days) => sum + days, 0);
  return {
    monthNames,
    daysPerMonth,
    hoursPerDay: calendar.hoursPerDay,
    secondsPerYear: daysInYear * DAY,
  };
}

export interface StoryDate {
  year: number;
  /** 0-based month index. */
  month: number;
  /** 1-based day of month. */
  day: number;
  hour: number;
  minute: number;
}

/** Splits a story time into calendar fields. Negative times walk backwards from the epoch. */
export function storyDateOf(calendar: TimelineCalendar, seconds: number): StoryDate {
  const shape = calendarShape(calendar);
  const year = Math.floor(seconds / shape.secondsPerYear) + 1;
  let rest = seconds - (year - 1) * shape.secondsPerYear;
  if (rest < 0) rest = 0;
  let month = 0;
  let daysLeft = Math.floor(rest / DAY);
  while (month < shape.daysPerMonth.length - 1 && daysLeft >= (shape.daysPerMonth[month] ?? 0)) {
    daysLeft -= shape.daysPerMonth[month] ?? 0;
    month += 1;
  }
  const secondsInDay = rest - Math.floor(rest / DAY) * DAY;
  return {
    year,
    month,
    day: daysLeft + 1,
    hour: Math.floor(secondsInDay / HOUR) % shape.hoursPerDay,
    minute: Math.floor(secondsInDay / 60) % 60,
  };
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function yearLabel(year: number, eraLabel: string): string {
  // Before the epoch the era label would be misleading ("500 AD BCE"), so pre-era years are
  // written as plain BCE — the label a writer would use.
  if (year >= 1) return `${year} ${eraLabel}`.trim();
  return `${1 - year} BCE`;
}

/** Short label for a tick at the given zoom — "14:00", "12 Mar", "Mar 1247", "1247". */
export function formatTick(
  calendar: TimelineCalendar,
  seconds: number,
  zoom: TimelineZoom,
): string {
  const date = storyDateOf(calendar, seconds);
  const shape = calendarShape(calendar);
  const month = shape.monthNames[date.month] ?? String(date.month + 1);
  switch (zoom.id) {
    case "hours":
      return `${pad(date.hour)}:${pad(date.minute)}`;
    case "days":
    case "weeks":
      return `${date.day} ${month}`;
    case "months":
      return `${month} ${yearLabel(date.year, calendar.eraLabel)}`;
    default:
      return yearLabel(date.year, calendar.eraLabel);
  }
}

/** Full label for an item tooltip or the event sheet — always unambiguous. */
export function formatStoryTimeFull(calendar: TimelineCalendar, seconds: number): string {
  const date = storyDateOf(calendar, seconds);
  const shape = calendarShape(calendar);
  const month = shape.monthNames[date.month] ?? String(date.month + 1);
  const hasClock = shape.hoursPerDay > 1 && (date.hour !== 0 || date.minute !== 0);
  const time = hasClock ? `, ${pad(date.hour)}:${pad(date.minute)}` : "";
  return `${date.day} ${month} ${yearLabel(date.year, calendar.eraLabel)}${time}`;
}

/**
 * Evenly spaced ticks across the window, snapped to the zoom's natural unit (an hour, a day, a
 * year …) so labels never read "14:37".
 */
export function timelineTicks(
  calendar: TimelineCalendar,
  startSeconds: number,
  endSeconds: number,
  zoom: TimelineZoom,
  targetCount = 6,
): Array<{ seconds: number; label: string }> {
  const shape = calendarShape(calendar);
  const span = Math.max(1, endSeconds - startSeconds);
  const units: Record<string, number> = {
    hours: HOUR,
    days: DAY,
    weeks: 7 * DAY,
    months: shape.secondsPerYear / shape.monthNames.length,
    years: shape.secondsPerYear,
    decades: 10 * shape.secondsPerYear,
    centuries: 100 * shape.secondsPerYear,
    millennia: 1000 * shape.secondsPerYear,
  };
  const unit = units[zoom.id] ?? shape.secondsPerYear;
  let step = Math.max(1, Math.round(span / targetCount / unit)) * unit;
  while (span / step > targetCount * 1.5) step *= 2;
  const first = Math.ceil(startSeconds / step) * step;
  const ticks: Array<{ seconds: number; label: string }> = [];
  for (let seconds = first; seconds <= endSeconds && ticks.length < 40; seconds += step) {
    ticks.push({ seconds, label: formatTick(calendar, seconds, zoom) });
  }
  return ticks;
}

/** Window to render around a set of items, padded so a lone item is not glued to the edge. */
export function timelineWindow(
  range: { start: number; end: number } | null,
  zoom: TimelineZoom,
): { start: number; end: number } {
  if (range === null) return { start: -zoom.spanSeconds / 2, end: zoom.spanSeconds / 2 };
  const span = Math.max(range.end - range.start, zoom.spanSeconds / 4);
  const center = (range.start + range.end) / 2;
  const pad = span * 0.15;
  return { start: center - span / 2 - pad, end: center + span / 2 + pad };
}

/** Fraction across the window (0–1) for positioning an item. */
export function positionFraction(seconds: number, window: { start: number; end: number }): number {
  const span = Math.max(1, window.end - window.start);
  return (seconds - window.start) / span;
}

/**
 * Parses what a writer types into a story time: "1247", "1247-03", "1247-03-12",
 * "1247-03-12 14:30". Returns null when the text is not a date, so the form can show its own
 * message instead of silently writing garbage.
 */
export function parseStoryTimeInput(calendar: TimelineCalendar, text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const match = /^(-?\d{1,7})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:[ T](\d{1,2}):(\d{2}))?$/.exec(
    trimmed,
  );
  if (!match) return null;
  const shape = calendarShape(calendar);
  const year = Number(match[1]);
  const month = match[2] === undefined ? 1 : Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  const hour = match[4] === undefined ? 0 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  if (month < 1 || month > shape.monthNames.length) return null;
  const daysThisMonth = shape.daysPerMonth[month - 1] ?? 0;
  if (day < 1 || day > daysThisMonth) return null;
  if (hour >= shape.hoursPerDay || minute > 59) return null;
  // Year 1 starts at the epoch; a year typed as -500 means "500 BCE", so it starts one whole
  // year earlier than a naive (year - 1) would place it.
  let seconds = (year >= 1 ? year - 1 : year) * shape.secondsPerYear;
  for (let index = 0; index < month - 1; index += 1) {
    seconds += (shape.daysPerMonth[index] ?? 0) * DAY;
  }
  seconds += (day - 1) * DAY + hour * HOUR + minute * 60;
  return seconds;
}

/** The exact form `parseStoryTimeInput` accepts, for prefilling the editor. */
export function formatStoryTimeInput(calendar: TimelineCalendar, seconds: number): string {
  const date = storyDateOf(calendar, seconds);
  const shape = calendarShape(calendar);
  const base = `${date.year}-${pad(date.month + 1)}-${pad(date.day)}`;
  if (shape.hoursPerDay <= 1) return base;
  return `${base} ${pad(date.hour)}:${pad(date.minute)}`;
}

export function parseCalendar(raw: string | null | undefined): TimelineCalendar {
  if (!raw) return { ...DEFAULT_TIMELINE_CALENDAR };
  try {
    const parsed = JSON.parse(raw) as { timelineCalendar?: Partial<TimelineCalendar> };
    const calendar = parsed.timelineCalendar;
    if (!calendar) return { ...DEFAULT_TIMELINE_CALENDAR };
    return {
      kind: calendar.kind === "custom" ? "custom" : "gregorian",
      eraLabel: typeof calendar.eraLabel === "string" ? calendar.eraLabel : "AD",
      monthNames: Array.isArray(calendar.monthNames) ? (calendar.monthNames as string[]) : null,
      daysPerMonth: Array.isArray(calendar.daysPerMonth)
        ? (calendar.daysPerMonth as number[])
        : null,
      hoursPerDay:
        typeof calendar.hoursPerDay === "number" && calendar.hoursPerDay > 0
          ? calendar.hoursPerDay
          : 24,
    };
  } catch {
    return { ...DEFAULT_TIMELINE_CALENDAR };
  }
}
