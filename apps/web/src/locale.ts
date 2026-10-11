/**
 * Locale wiring for the web app (decision 22): first run follows the system language
 * (uk → Ukrainian, else English), Settings offers an explicit choice, and the choice is
 * remembered per device. `starline.locale` holds only an explicit pick — its absence means
 * "follow the system", which is also what the Settings control's third option restores.
 */
import { getLocale, isLocale, type Locale, setLocale } from "@starline/core";
import { create } from "zustand";

const LOCALE_KEY = "starline.locale";

function readStored(): Locale | null {
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    // Private mode: no storage, just follow the system this session.
    return null;
  }
}

function detect(): Locale {
  const stored = readStored();
  if (stored !== null) return stored;
  const languages =
    typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if (isLocale(base)) return base;
  }
  return "en";
}

function apply(locale: Locale): void {
  setLocale(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

interface LocaleState {
  locale: Locale;
  /** The explicit device choice, or null while following the system language. */
  chosen: Locale | null;
  choose: (locale: Locale | null) => void;
}

export const useLocaleStore = create<LocaleState>()((set) => ({
  locale: detect(),
  chosen: readStored(),
  choose: (locale) => {
    try {
      if (locale === null) localStorage.removeItem(LOCALE_KEY);
      else localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // Private mode: the choice lasts for this session only.
    }
    const next = locale ?? detect();
    apply(next);
    set({ locale: next, chosen: locale });
  },
}));

/** Runs at boot, before the first render, so no component ever sees the wrong catalogue. */
export function initLocale(): void {
  apply(useLocaleStore.getState().locale);
}

const numberFormats = new Map<Locale, Intl.NumberFormat>();
const dateTimeFormats = new Map<Locale, Intl.DateTimeFormat>();
const clockFormats = new Map<Locale, Intl.DateTimeFormat>();

/** Grouped digits in the active locale ("1 200" in uk, "1,200" in en). */
export function formatNumber(value: number): string {
  const locale = getLocale();
  let format = numberFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format.format(value);
}

/** Medium date + short time in the active locale. */
export function formatDateTime(timestamp: number): string {
  const locale = getLocale();
  let format = dateTimeFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
    dateTimeFormats.set(locale, format);
  }
  return format.format(new Date(timestamp));
}

/** Wall-clock time (writing mode's "saved 14:32"). */
export function formatClock(date: Date): string {
  const locale = getLocale();
  let format = clockFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
    clockFormats.set(locale, format);
  }
  return format.format(date);
}
