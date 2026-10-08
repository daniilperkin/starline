import {
  blockingIssues,
  EMPTY_RICH_TEXT,
  EXPANSION_KEYS,
  type ExpansionKey,
  messages,
  type RichText,
  type SnowflakeStepRow,
  type Step4Content,
  type Step6Content,
  StepBlockedError,
  type UUID,
  type ValidationIssue,
  validateStep6,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCompleteStep, useSaveStep, useSteps } from "./data";
import { IssueList } from "./IssueList";
import { PromptsSheet } from "./PromptsSheet";
import { RichTextEditor } from "./RichTextEditor";
import { useAutosave } from "./useAutosave";

/** Step 6 — the four-page synopsis: five sections, 1:1 with the step-4 paragraphs (decision 3). */
export function Step6Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const [content, setContent] = useState<Step6Content>(row.content as Step6Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const navigate = useNavigate();

  const steps = useSteps(projectId);
  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();

  const step4 = useMemo(
    () =>
      (steps.data?.find((candidate) => candidate.step === 4)?.content ??
        null) as Step4Content | null,
    [steps.data],
  );

  const flush = useAutosave(content, async (value) => {
    try {
      await saveStep.mutateAsync({ projectId, step: 6, content: value });
      return true;
    } catch {
      return false;
    }
  });

  const issues = useMemo(() => validateStep6(content), [content]);
  const errors = blockingIssues(issues);

  const sourceFor = (key: ExpansionKey): string =>
    step4?.paragraphs.find((paragraph) => paragraph.sourceKey === key)?.text.text ?? "";

  const sectionFor = (key: ExpansionKey): RichText =>
    content.sections.find((section) => section.sourceKey === key)?.text ?? EMPTY_RICH_TEXT;

  const setSection = (key: ExpansionKey, value: RichText) => {
    setContent((previous) => {
      const rest = previous.sections.filter((section) => section.sourceKey !== key);
      return { sections: [...rest, { sourceKey: key, text: value }] };
    });
  };

  const toggleIgnore = (code: string) => {
    setIgnored((previous) => {
      const next = new Set(previous);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const onComplete = async () => {
    setCompleting(true);
    setBlocked([]);
    try {
      await flush();
      await completeStep.mutateAsync({ projectId, step: 6, overrides: [...ignored] });
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
        <p className="text-sm text-muted">{messages.step6.lead}</p>
      </section>

      {EXPANSION_KEYS.map((key) => (
        <section key={key} className="sl-card flex flex-col gap-2 p-4">
          <details className="sl-source" open>
            <summary className="text-xs font-medium tracking-wide text-muted uppercase">
              {messages.step6.sourceLabel} · {messages.step2[key]}
            </summary>
            <p className="mt-1 text-sm text-muted">
              {sourceFor(key) || messages.step4.emptySource}
            </p>
          </details>
          <RichTextEditor
            initial={sectionFor(key)}
            ariaLabel={messages.step2[key]}
            onChange={(value) => setSection(key, value)}
          />
        </section>
      ))}

      <IssueList
        issues={blocked.length > 0 ? blocked : issues}
        ignored={ignored}
        onToggleIgnore={toggleIgnore}
      />

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

      <PromptsSheet open={promptsOpen} step={6} onClose={() => setPromptsOpen(false)} />
    </div>
  );
}
