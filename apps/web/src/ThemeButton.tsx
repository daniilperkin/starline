import { messages } from "@starline/core";
import { useState } from "react";
import { cycleTheme, getThemePreference, type ThemePreference } from "./theme";

/**
 * Cycles through the five themes. The labels live in the catalogue like every other string —
 * they used to be hardcoded English here, which the i18n sweep had missed because the button
 * is chrome rather than content.
 */
const THEME_LABEL: Record<ThemePreference, () => string> = {
  system: () => messages.settings.themeSystem,
  light: () => messages.settings.themeLight,
  dark: () => messages.settings.themeDark,
  sepia: () => messages.settings.themeSepia,
  contrast: () => messages.settings.themeContrast,
};

export function ThemeButton() {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference());
  return (
    <button
      type="button"
      className="sl-btn"
      data-testid="sl-theme-cycle"
      onClick={() => setTheme(cycleTheme())}
    >
      {THEME_LABEL[theme]()}
    </button>
  );
}
