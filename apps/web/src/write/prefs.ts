import { useCallback, useState } from "react";

/**
 * Writing-mode device preferences (PLAN slice 13). Type size, serif and caret position are
 * device state, not library state: they belong on this phone, not in the .starline file, so
 * they live in localStorage next to the theme. The scene the writer stopped on is the opposite
 * — it travels with the file (see `@starline/core` editor state).
 */

export interface Typography {
  serif: boolean;
  /** Body text size in px; the spec's range is 14–24 (spec §4.0 typography). */
  size: number;
}

export const TYPOGRAPHY_SIZES = [14, 16, 18, 20, 22, 24] as const;
const DEFAULT_TYPOGRAPHY: Typography = { serif: false, size: 18 };
const TYPOGRAPHY_KEY = "starline.writing.typography";
const CARET_PREFIX = "starline.writing.caret.";

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null; // private mode / hand-edited value: fall back to defaults
  }
}

export function readTypography(): Typography {
  const stored = readJson<Partial<Typography>>(TYPOGRAPHY_KEY);
  const size =
    typeof stored?.size === "number" &&
    (TYPOGRAPHY_SIZES as readonly number[]).includes(stored.size)
      ? stored.size
      : DEFAULT_TYPOGRAPHY.size;
  return { serif: stored?.serif === true, size };
}

/** Typography prefs + a setter that persists on every change (cheap, no debounce needed). */
export function useTypography(): [Typography, (patch: Partial<Typography>) => void] {
  const [typography, setTypography] = useState<Typography>(readTypography);
  const update = useCallback((patch: Partial<Typography>) => {
    setTypography((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(TYPOGRAPHY_KEY, JSON.stringify(next));
      } catch {
        // Storage full or blocked: the session keeps the setting, it just will not persist.
      }
      return next;
    });
  }, []);
  return [typography, update];
}

export interface CaretPosition {
  from: number;
  to: number;
}

/** Caret per scene, so switching away and back lands where the writer left the cursor. */
export function readCaret(sceneId: string): CaretPosition | null {
  const stored = readJson<Partial<CaretPosition>>(`${CARET_PREFIX}${sceneId}`);
  return typeof stored?.from === "number" && typeof stored?.to === "number"
    ? { from: stored.from, to: stored.to }
    : null;
}

export function writeCaret(sceneId: string, position: CaretPosition): void {
  try {
    window.localStorage.setItem(`${CARET_PREFIX}${sceneId}`, JSON.stringify(position));
  } catch {
    // Best effort; losing a caret position is not worth an error path.
  }
}
