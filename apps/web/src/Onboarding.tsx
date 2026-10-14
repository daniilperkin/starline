/** The onboarding wizard (S37): four skippable slides shown on first run. */
import { messages } from "@starline/core";
import { useState } from "react";

export const ONBOARDING_MODULES = [
  "snowflake",
  "characters",
  "graph",
  "outliner",
  "timeline",
  "wiki",
  "notes",
] as const;

/** The device-level first-run flag; the project's own settings carry the picked modules. */
export const ONBOARDING_KEY = "starline.onboarding.done";

export function Onboarding({ onDone }: { onDone: (modules: string[] | null) => void }) {
  const [slide, setSlide] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ONBOARDING_MODULES));
  const last = slide === 3;

  return (
    <div
      className="sl-onboarding fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="sl-onboarding"
    >
      <div className="sl-card flex w-full max-w-lg flex-col gap-4 p-6">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="sl-onboarding-dot" data-active={index === slide} />
          ))}
        </div>

        {slide === 0 ? (
          <>
            <h2 className="text-xl font-semibold tracking-tight" data-testid="sl-onboarding-title">
              {messages.onboarding.welcomeTitle}
            </h2>
            <p className="text-sm text-muted">{messages.onboarding.welcomeBody}</p>
          </>
        ) : slide === 1 ? (
          <>
            <h2 className="text-xl font-semibold tracking-tight" data-testid="sl-onboarding-title">
              {messages.onboarding.methodTitle}
            </h2>
            <p className="text-sm text-muted">{messages.onboarding.methodBody}</p>
          </>
        ) : slide === 2 ? (
          <>
            <h2 className="text-xl font-semibold tracking-tight" data-testid="sl-onboarding-title">
              {messages.onboarding.modulesTitle}
            </h2>
            <p className="text-sm text-muted">{messages.onboarding.modulesBody}</p>
            <div className="flex flex-col gap-2">
              {ONBOARDING_MODULES.map((module) => (
                <label key={module} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid={`sl-onboarding-${module}`}
                    checked={picked.has(module)}
                    onChange={(event) =>
                      setPicked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(module);
                        else next.delete(module);
                        return next;
                      })
                    }
                  />
                  {messages.settings.moduleNames[module]}
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold tracking-tight" data-testid="sl-onboarding-title">
              {messages.onboarding.readyTitle}
            </h2>
            <p className="text-sm text-muted">{messages.onboarding.readyBody}</p>
          </>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="sl-btn-small"
            data-testid="sl-onboarding-skip"
            onClick={() => onDone(null)}
          >
            {messages.onboarding.skip}
          </button>
          <div className="flex items-center gap-2">
            {slide > 0 ? (
              <button
                type="button"
                className="sl-btn"
                data-testid="sl-onboarding-back"
                onClick={() => setSlide((current) => current - 1)}
              >
                {messages.onboarding.back}
              </button>
            ) : null}
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              data-testid="sl-onboarding-next"
              onClick={() => {
                if (last) onDone([...picked]);
                else setSlide((current) => current + 1);
              }}
            >
              {last ? messages.onboarding.start : messages.onboarding.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
