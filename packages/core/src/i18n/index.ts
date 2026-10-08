import { en, type Messages } from "./en";

/** The active catalogue. Future locales swap here (a provider arrives with the second locale). */
export const messages: Messages = en;

export type { Messages } from "./en";
export { en } from "./en";

/** Interpolates `{name}` placeholders; unknown placeholders stay visible (never silently dropped). */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}
