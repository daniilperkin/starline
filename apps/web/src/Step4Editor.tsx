import {
  blockingIssues,
  EMPTY_RICH_TEXT,
  EXPANSION_KEYS,
  type ExpansionKey,
  messages,
  type RichText,
  type SnowflakeStepRow,
  type Step2Content,
  type Step4Content,
  StepBlockedError,
  seedStep4FromStep2,
  type UUID,
  type ValidationIssue,
  validateStep4,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCompleteStep, useSaveStep, useSteps } from "./data";
import { IssueList } from "./IssueList";
import { PromptsSheet } from "./PromptsSheet";
import { RichTextEditor } from "./RichTextEditor";
import { useAutosave } from "./useAutosave";

/** Step 4 — five paragraphs, each expanding one step-2 sentence (spec §4.2 point 6). */
export function Step4Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const [content, setContent] = useState<Step4Content>(row.content as Step4Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [seedVersion, setSeedVersion] = useState(0);
  const navigate = useNavigate();

  const steps = useSteps(projectId);
  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();

  const step2 = useMemo(
    () =>
      (steps.data?.find((candidate) => candidate.step === 2)?.content ??
        null) as Step2Content | null,
    [steps.data],
  );

  const flush = useAutosave(content, async (value) => {
    try {
      await saveStep.mutateAsync({ projectId, step: 4, content: value });
      return true;
    } catch {
      return false;
    }
  });

  const issues = useMemo(() => validateStep4(content), [content]);
  const errors = blockingIssues(issues);

  const paragraphFor = (key: ExpansionKey): RichText =>
    content.paragraphs.find((paragraph) => paragraph.sourceKey === key)?.text ?? EMPTY_RICH_TEXT;

  const setParagraph = (key: ExpansionKey, value: RichText) => {
    setContent((previous) => ({
      paragraphs: EXPANSION_KEYS.map((expansionKey) => ({
        sourceKey: expansionKey,
        text:
          expansionKey === key
            ? value
            : (previous.paragraphs.find((paragraph) => paragraph.sourceKey === expansionKey)
                ?.text ?? EMPTY_RICH_TEXT),
      })),
    }));
  };

  // The seed trigger only appears on a blank slate — replacing written paragraphs would lose work.
  const canSeed =
    step2 !== null && content.paragraphs.every((paragraph) => paragraph.text.text.trim() === "");

  const onSeed = () => {
    if (step2 === null) return;
    setContent(seedStep4FromStep2(step2));
    setSeedVersion((previous) => previous + 1);
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
      await completeStep.mutateAsync({ projectId, step: 4, overrides: [...ignored] });
      await navigate({ to: "/plan" });
    } catch (cause) {
      if (cause instanceof StepBlockedError) setBlocked([...cause.issues]);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="sl-card flex flex-col gap-3 p-5">
        <p className="text-sm text-muted">{messages.step4.lead}</p>
        <button type="button" className="sl-btn" disabled={!canSeed} onClick={onSeed}>
          ✦ {messages.step4.seedButton}
        </button>
      </section>

      {EXPANSION_KEYS.map((key) => (
        <section key={key} className="sl-card flex flex-col gap-2 p-4">
          <details className="sl-source" open>
            <summary className="text-xs font-medium tracking-wide text-muted uppercase">
              {messages.step4.sourceLabel} · {messages.step2[key]}
            </summary>
            <p className="mt-1 text-sm text-muted">
              {(step2?.[key] ?? "").trim() || messages.step4.emptySource}
            </p>
          </details>
          <RichTextEditor
            key={`${key}-${seedVersion}`}
            initial={paragraphFor(key)}
            ariaLabel={messages.step2[key]}
            onChange={(value) => setParagraph(key, value)}
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

      <PromptsSheet open={promptsOpen} step={4} onClose={() => setPromptsOpen(false)} />
    </div>
  );
}
