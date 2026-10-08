export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "starline.theme";
const ORDER: ThemePreference[] = ["system", "light", "dark"];

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  // The star library is a night sky: dark is the default until the writer chooses otherwise.
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}

export function applyTheme(preference: ThemePreference): void {
  const resolved =
    preference === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  // The starfield redraws itself for the new palette (Starfield.tsx).
  window.dispatchEvent(new CustomEvent("starline:theme", { detail: { theme: resolved } }));
}

export function setThemePreference(preference: ThemePreference): ThemePreference {
  localStorage.setItem(STORAGE_KEY, preference);
  applyTheme(preference);
  return preference;
}

export function cycleTheme(): ThemePreference {
  const next = ORDER[(ORDER.indexOf(getThemePreference()) + 1) % ORDER.length] ?? "system";
  return setThemePreference(next);
}
