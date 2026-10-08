import {
  blockingIssues,
  countWords,
  epochNow,
  format,
  messages,
  newUuid,
  type SnowflakeStepRow,
  type Step1Content,
  StepBlockedError,
  type UUID,
  type ValidationIssue,
  validateStep1,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCompleteStep, useSaveStep } from "./data";
import { IssueList } from "./IssueList";
import { PromptsSheet } from "./PromptsSheet";
import { useAutosave } from "./useAutosave";

const MAX_ALTERNATIVES = 20;

/** Step 1 — one sentence (spec §4.2: counter, alternatives, prompts, soft-gated completion). */
export function Step1Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const [content, setContent] = useState<Step1Content>(row.content as Step1Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const navigate = useNavigate();

  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();
  const flush = useAutosave(content, async (value) => {
    try {
      await saveStep.mutateAsync({ projectId, step: 1, content: value });
      return true;
    } catch {
      return false;
    }
  });

  const issues = useMemo(() => validateStep1(content), [content]);
  const errors = blockingIssues(issues);
  const words = countWords(content.sentence.trim());

  const toggleIgnore = (code: string) => {
    setIgnored((previous) => {
      const next = new Set(previous);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const tryAnother = () => {
    const text = content.sentence.trim();
    if (text.length === 0) return;
    setContent({
      sentence: "",
      alternatives: [{ id: newUuid(), text, createdAt: epochNow() }, ...content.alternatives].slice(
        0,
        MAX_ALTERNATIVES,
      ),
    });
  };

  const promote = (id: string) => {
    const alternative = content.alternatives.find((candidate) => candidate.id === id);
    if (!alternative) return;
    const current = content.sentence.trim();
    setContent({
      sentence: alternative.text,
      alternatives: [
        ...(current.length > 0 ? [{ id: newUuid(), text: current, createdAt: epochNow() }] : []),
        ...content.alternatives.filter((candidate) => candidate.id !== id),
      ].slice(0, MAX_ALTERNATIVES),
    });
  };

  const onComplete = async () => {
    setCompleting(true);
    setBlocked([]);
    try {
      await flush();
      await completeStep.mutateAsync({ projectId, step: 1, overrides: [...ignored] });
      await navigate({ to: "/plan" });
    } catch (cause) {
      if (cause instanceof StepBlockedError) setBlocked([...cause.issues]);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="sl-card p-5">
        <p className="text-sm text-muted">{messages.step1.lead}</p>
        <textarea
          className="sl-textarea mt-3"
          rows={3}
          aria-label={messages.steps[1]}
          placeholder={messages.step1.placeholder}
          value={content.sentence}
          onChange={(event) => setContent({ ...content, sentence: event.target.value })}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">
            {format(messages.step1.wordCounter, { words })}
          </span>
          <button
            type="button"
            className="sl-btn"
            disabled={content.sentence.trim().length === 0}
            onClick={tryAnother}
          >
            {messages.step1.tryAnother}
          </button>
        </div>
      </section>

      <IssueList
        issues={blocked.length > 0 ? blocked : issues}
        ignored={ignored}
        onToggleIgnore={toggleIgnore}
      />

      {content.alternatives.length > 0 ? (
        <section className="sl-card p-4">
          <h2 className="text-xs font-medium tracking-wide text-muted uppercase">
            {messages.step1.alternativesHeading}
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {content.alternatives.map((alternative) => (
              <li
                key={alternative.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line px-3 py-2"
              >
                <span className="text-sm">{alternative.text}</span>
                <button
                  type="button"
                  className="sl-btn shrink-0"
                  onClick={() => promote(alternative.id)}
                >
                  {messages.step1.promote}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="sl-btn" onClick={() => setPromptsOpen(true)}>
          ✦ {messages.prompts.heading}
        </button>
        <button
          type="button"
          className="sl-btn sl-btn-primary flex-1"
          disabled={completing || errors.length > 0 || row.status === "complete"}
          onClick={() => void onComplete()}
        >
          {row.status === "complete" ? messages.plan.status.complete : messages.plan.markComplete}
        </button>
      </div>

      <PromptsSheet open={promptsOpen} step={1} onClose={() => setPromptsOpen(false)} />
    </div>
  );
}
