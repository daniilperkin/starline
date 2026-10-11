/**
 * Device preferences for the decorative effects (slice 19, WCAG 2.2.2).
 *
 * The starfield is the app's visual identity, so it is on by default — but moving content that
 * starts on its own needs a way to stop it. Settings → Appearance owns the switch, and the
 * value lives in localStorage because it describes this device, not the library file (the same
 * rule as the writing-mode typography, decision 20/slice 13).
 */

const STARFIELD_KEY = "starline.effects.starfield";

/** Fired on `window` whenever the preference changes, so live canvases can react. */
export const STARFIELD_EVENT = "starline:starfield";

export function starfieldAnimated(): boolean {
  try {
    return localStorage.getItem(STARFIELD_KEY) !== "off";
  } catch {
    return true; // private mode or storage denied: keep the default look
  }
}

export function setStarfieldAnimated(animated: boolean): void {
  try {
    localStorage.setItem(STARFIELD_KEY, animated ? "on" : "off");
  } catch {
    // nothing to persist — the event below still updates the running canvas
  }
  window.dispatchEvent(new Event(STARFIELD_EVENT));
}
