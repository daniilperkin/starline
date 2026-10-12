import { messages, type SnowflakeStepNumber, stepPrompt } from "@starline/core";
import { useEffect } from "react";
import { useLocaleStore } from "./locale";

/** The bundled offline prompt library as a bottom sheet (spec §4.1, decision 15). */
export function PromptsSheet({
  open,
  step,
  onClose,
}: {
  open: boolean;
  step: SnowflakeStepNumber;
  onClose: () => void;
}) {
  const locale = useLocaleStore((state) => state.locale);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const prompt = stepPrompt(locale, step);

  return (
    <>
      <button
        type="button"
        className="sl-sheet-backdrop"
        aria-label={messages.common.close}
        onClick={onClose}
      />
      <section
        className="sl-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={messages.prompts.heading}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{messages.prompts.heading}</h2>
          <button
            type="button"
            className="sl-btn"
            aria-label={messages.common.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <p className="mt-1 text-xs text-muted">{messages.prompts.offlineNote}</p>

        <h3 className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">
          {messages.prompts.rule}
        </h3>
        <p className="mt-1 text-sm">{prompt.rule}</p>

        <h3 className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">
          {messages.prompts.examples}
        </h3>
        <ul className="mt-2 flex flex-col gap-2">
          {prompt.examples.map((example) => (
            <li key={example.source} className="rounded-xl border border-line px-3 py-2">
              <div className="text-xs tracking-wide text-accent uppercase">{example.source}</div>
              <p className="mt-1 text-sm">{example.text}</p>
            </li>
          ))}
        </ul>

        <h3 className="mt-4 text-xs font-medium tracking-wide text-muted uppercase">
          {messages.prompts.questions}
        </h3>
        <ul className="mt-2 mb-1 flex flex-col gap-1 text-sm">
          {prompt.questions.map((question) => (
            <li key={question}>• {question}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
