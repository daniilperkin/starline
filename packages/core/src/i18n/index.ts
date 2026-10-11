/**
 * The i18n runtime (decision 20: launch languages English + Ukrainian).
 *
 * `messages` is a live proxy over the active catalogue, so the ~650 existing call sites keep
 * working unchanged; switching locale re-reads every string on the next render. The app
 * remounts its route tree on a switch, which is what makes that re-read happen.
 */
import { en } from "./en";
import { uk } from "./uk";

/** Locales that ship with the app. */
export const availableLocales = ["en", "uk"] as const;
export type Locale = (typeof availableLocales)[number];

/** A counted noun phrase; categories follow the locale's own plural rules (uk: one/few/many/other). */
export interface PluralForms {
  one?: string;
  few?: string;
  many?: string;
  other: string;
}

type Widen<T> = T extends string
  ? string
  : T extends { other: string }
    ? PluralForms
    : { readonly [K in keyof T]: Widen<T[K]> };

/** The catalogue shape with widened leaves: every locale implements it, the strings differ. */
export type Messages = Widen<typeof en>;

export const catalogues: Record<Locale, Messages> = { en, uk };

let activeLocale: Locale = "en";
const rules = new Map<Locale, Intl.PluralRules>();

export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

/** True when the string is a locale we ship (used by the web layer before calling setLocale). */
export function isLocale(value: string | null | undefined): value is Locale {
  return (
    value !== null && value !== undefined && (availableLocales as readonly string[]).includes(value)
  );
}

/** The active catalogue. Reads follow `setLocale`; nothing is captured at import time. */
export const messages: Messages = new Proxy({} as Messages, {
  get: (_target, key: string | symbol) => catalogues[activeLocale][key as keyof Messages],
});

/** Interpolates `{name}` placeholders; unknown placeholders stay visible (never silently dropped). */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

/**
 * Picks the plural form for `count` in the active locale and interpolates it.
 * `extra` carries any other placeholders the template needs ({words}, {placed}, …).
 */
export function plural(
  forms: PluralForms,
  count: number,
  extra: Record<string, string | number> = {},
): string {
  let rulesForLocale = rules.get(activeLocale);
  if (!rulesForLocale) {
    rulesForLocale = new Intl.PluralRules(activeLocale);
    rules.set(activeLocale, rulesForLocale);
  }
  const category = rulesForLocale.select(count) as keyof PluralForms;
  return format(forms[category] ?? forms.other, { n: count, count, ...extra });
}

/** Resolves a ValidationIssue.code to its message in the active locale (falls back to the code). */
export function issueMessage(code: string): string {
  return (catalogues[activeLocale].issues as Record<string, string>)[code] ?? code;
}

export { en } from "./en";
export { uk } from "./uk";
