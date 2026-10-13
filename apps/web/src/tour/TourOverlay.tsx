import { format, messages } from "@starline/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { navigateTo } from "./navigate";
import { TOUR_STOPS } from "./stops";

/**
 * The guided tour (slice 26, decision 26b).
 *
 * One overlay, fifteen stops, each a route plus an optional anchor on it. The tour navigates
 * itself: a stop that belongs on the Scenes tab takes you there before it speaks. Anchors are
 * measured after the route's screen has mounted (two frames, then a settle pass, because a screen
 * that renders a list can shift once its data lands), and a stop whose anchor never appears shows
 * centred instead — the words are the point, the spotlight is the courtesy.
 *
 * Accessibility: the card is a modal dialog, focus moves to it on every stop, Escape ends the
 * tour, and the spotlight is decorative (the card carries the meaning).
 */

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_GAP = 12;
const CARD_MARGIN = 12;
const CARD_ESTIMATED_HEIGHT = 210;

export function TourOverlay({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stop = TOUR_STOPS[index];

  /** Returns true when the anchor was found and measured. */
  const measure = useCallback((): boolean => {
    if (stop === undefined || stop.target === null) {
      setRect(null);
      return false;
    }
    const node = document.querySelector(stop.target);
    if (node === null) {
      setRect(null);
      return false;
    }
    const box = node.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) {
      setRect(null);
      return false;
    }
    setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    return true;
  }, [stop]);

  useEffect(() => {
    if (stop === undefined) return;
    navigateTo(stop.route);
    setRect(null);
    // The anchor can arrive late — a screen that fetches its data renders its rows after the route
    // has already mounted. So: two frames for the mount, then a poll until the anchor appears (or
    // the budget runs out, and the stop shows centred instead). Everything is cancelled together
    // if the stop changes underneath us.
    const tryOnce = (): boolean => {
      const node = stop.target === null ? null : document.querySelector(stop.target);
      if (node !== null) node.scrollIntoView({ block: "center", behavior: "instant" });
      return measure();
    };
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        tryOnce();
      });
    });
    let tries = 0;
    const poll = window.setInterval(() => {
      tries += 1;
      if (tryOnce() || tries >= 16) window.clearInterval(poll);
    }, 150);
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== 0) cancelAnimationFrame(raf2);
      window.clearInterval(poll);
    };
  }, [measure, stop]);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  // Escape ends the tour from anywhere. A window listener rather than a handler on the root
  // element: the overlay is a presentation layer, not a control, and focus lives on the card.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  if (stop === undefined) return null;

  const cardStyle = ((): React.CSSProperties => {
    if (rect === null) {
      return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
    }
    const left = Math.min(
      Math.max(CARD_MARGIN, rect.left + rect.width / 2 - 160),
      Math.max(CARD_MARGIN, window.innerWidth - 332),
    );
    if (stop.placement === "top") {
      const top = rect.top - CARD_ESTIMATED_HEIGHT - CARD_GAP;
      return top >= CARD_MARGIN ? { left, top } : { left, top: rect.top + rect.height + CARD_GAP };
    }
    const below = rect.top + rect.height + CARD_GAP;
    const top =
      below + CARD_ESTIMATED_HEIGHT <= window.innerHeight - CARD_MARGIN
        ? below
        : Math.max(CARD_MARGIN, rect.top - CARD_ESTIMATED_HEIGHT - CARD_GAP);
    return { left, top };
  })();

  const last = index + 1 >= TOUR_STOPS.length;
  const copy = messages.tour.stops[stop.id];

  return (
    <div className="sl-tour" data-testid="sl-tour">
      {rect === null ? (
        <div className="sl-tour-dim" aria-hidden="true" />
      ) : (
        <div
          className="sl-tour-spotlight"
          data-testid="sl-tour-spotlight"
          aria-hidden="true"
          style={{
            top: `${rect.top - 6}px`,
            left: `${rect.left - 6}px`,
            width: `${rect.width + 12}px`,
            height: `${rect.height + 12}px`,
          }}
        />
      )}
      <div
        ref={cardRef}
        className="sl-tour-card"
        data-testid="sl-tour-card"
        role="dialog"
        aria-modal="true"
        aria-label={messages.tour.heading}
        tabIndex={-1}
        style={cardStyle}
      >
        <p className="sl-tour-progress" data-testid="sl-tour-progress">
          {format(messages.tour.stepOf, { n: index + 1, total: TOUR_STOPS.length })}
        </p>
        <h2 className="sl-tour-title">{copy.title}</h2>
        <p className="sl-tour-body">{copy.body}</p>
        <div className="sl-tour-actions">
          <button
            type="button"
            className="sl-btn sl-btn-quiet"
            data-testid="sl-tour-skip"
            onClick={onDone}
          >
            {messages.tour.skip}
          </button>
          <span className="ml-auto flex gap-2">
            {index > 0 ? (
              <button
                type="button"
                className="sl-btn"
                data-testid="sl-tour-back"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
              >
                {messages.tour.back}
              </button>
            ) : null}
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              data-testid="sl-tour-next"
              onClick={() => {
                if (last) {
                  onDone();
                  return;
                }
                setIndex((current) => current + 1);
              }}
            >
              {last ? messages.tour.done : messages.tour.next}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
