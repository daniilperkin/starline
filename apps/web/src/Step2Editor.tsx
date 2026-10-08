import {
  blockingIssues,
  messages,
  type SnowflakeStepRow,
  STEP2_PARTS,
  type Step2Content,
  type Step2Part,
  StepBlockedError,
  type UUID,
  type ValidationIssue,
  validateStep2,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCompleteStep, useSaveStep } from "./data";
import { IssueList } from "./IssueList";
import { PromptsSheet } from "./PromptsSheet";
import { useAutosave } from "./useAutosave";

/** Step 2 — one paragraph: setup, three escalating disasters, ending. */
export function Step2Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const [content, setContent] = useState<Step2Content>(row.content as Step2Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const navigate = useNavigate();

  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();
  const flush = useAutosave(content, async (value) => {
    try {
      await saveStep.mutateAsync({ projectId, step: 2, content: value });
      return true;
    } catch {
      return false;
    }
  });

  const issues = useMemo(() => validateStep2(content), [content]);
  const errors = blockingIssues(issues);

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
      await completeStep.mutateAsync({ projectId, step: 2, overrides: [...ignored] });
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
        <p className="text-sm text-muted">{messages.step2.lead}</p>
        {STEP2_PARTS.map((part) => (
          <div key={part}>
            <label
              className="text-xs font-medium tracking-wide text-muted uppercase"
              htmlFor={`step2-${part}`}
            >
              {messages.step2[part]}
            </label>
            <textarea
              id={`step2-${part}`}
              className="sl-textarea mt-1"
              rows={2}
              placeholder={messages.step2.placeholders[part]}
              value={content[part]}
              onChange={(event) => setContent(withPart(content, part, event.target.value))}
            />
          </div>
        ))}
      </section>

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

      <PromptsSheet open={promptsOpen} step={2} onClose={() => setPromptsOpen(false)} />
    </div>
  );
}

function withPart(content: Step2Content, part: Step2Part, value: string): Step2Content {
  switch (part) {
    case "setup":
      return { ...content, setup: value };
    case "disaster1":
      return { ...content, disaster1: value };
    case "disaster2":
      return { ...content, disaster2: value };
    case "disaster3":
      return { ...content, disaster3: value };
    case "ending":
      return { ...content, ending: value };
  }
}
