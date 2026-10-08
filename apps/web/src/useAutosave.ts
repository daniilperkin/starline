import { useCallback, useEffect, useRef } from "react";

const BACKGROUND_EVENT = "starline:background";

/**
 * Debounced autosave (spec §4.2.1: 400 ms after typing stops). Flushes on unmount, when the
 * tab is hidden, and on the native background event. `saveFn` resolves true when the write
 * landed; failed or superseded saves stay dirty and retry on a short timer.
 * Returns `flush` — call it before any command that must see the latest content.
 */
export function useAutosave<T>(
  content: T,
  saveFn: (content: T) => Promise<boolean>,
  delayMs = 400,
): () => Promise<void> {
  const serialized = JSON.stringify(content);
  const latest = useRef({ content, serialized });
  latest.current = { content, serialized };
  const saveRef = useRef(saveFn);
  saveRef.current = saveFn;
  const lastSaved = useRef(serialized);
  const timer = useRef<number | null>(null);
  const inflight = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (latest.current.serialized !== lastSaved.current) {
      const payload = latest.current;
      inflight.current = saveRef
        .current(payload.content)
        .then((ok) => {
          if (ok) lastSaved.current = payload.serialized;
        })
        .catch(() => undefined);
      await inflight.current;
    } else {
      await inflight.current;
    }
    // Anything still unsaved (a failed write, or edits that raced the save) retries shortly.
    if (latest.current.serialized !== lastSaved.current && timer.current === null) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void flush();
      }, 1500);
    }
  }, []);

  useEffect(() => {
    if (serialized === lastSaved.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void flush();
    }, delayMs);
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [serialized, delayMs, flush]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onBackground = () => void flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener(BACKGROUND_EVENT, onBackground);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener(BACKGROUND_EVENT, onBackground);
      void flush();
    };
  }, [flush]);

  return flush;
}
