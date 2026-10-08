import { useState } from "react";
import { cycleTheme, getThemePreference, type ThemePreference } from "./theme";

const THEME_LABEL: Record<ThemePreference, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

export function ThemeButton() {
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference());
  return (
    <button type="button" className="sl-btn" onClick={() => setTheme(cycleTheme())}>
      {THEME_LABEL[theme]}
    </button>
  );
}
