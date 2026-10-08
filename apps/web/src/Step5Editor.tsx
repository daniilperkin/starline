import {
  blockingIssues,
  type CharacterSummary,
  format,
  messages,
  type RichText,
  type SnowflakeStepRow,
  type Step3Content,
  type Step5Content,
  StepBlockedError,
  type UUID,
  type ValidationIssue,
  validateStep5,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toContextInfo } from "./characterDraft";
import { useCharacters, useCompleteStep, useSaveStep, useSteps, useUpdateCharacter } from "./data";
import { IssueList } from "./IssueList";
import { PromptsSheet } from "./PromptsSheet";
import { RichTextEditor } from "./RichTextEditor";
import { useAutosave } from "./useAutosave";

/** Step 5 — character descriptions from each character's point of view (spec §3.4). */
export function Step5Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const [content, setContent] = useState<Step5Content>(row.content as Step5Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const navigate = useNavigate();

  const characters = useCharacters(projectId);
  const steps = useSteps(projectId);
  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();

  const list = characters.data ?? [];
  const majors = useMemo(
    () =>
      (
        (steps.data?.find((candidate) => candidate.step === 3)?.content ??
          null) as Step3Content | null
      )?.majorCharacterIds ?? [],
    [steps.data],
  );
  const ordered = useMemo(() => {
    const rank = (id: UUID) => (majors.includes(id) ? 0 : 1);
    return [...list].sort(
      (a, b) => rank(a.id) - rank(b.id) || a.orderKey.localeCompare(b.orderKey),
    );
  }, [list, majors]);

  const flush = useAutosave(content, async (value) => {
    try {
      await saveStep.mutateAsync({ projectId, step: 5, content: value });
      return true;
    } catch {
      return false;
    }
  });

  const issues = useMemo(
    () =>
      validateStep5(content, { characters: list.map(toContextInfo), majorCharacterIds: majors }),
    [content, list, majors],
  );
  const errors = blockingIssues(issues);

  const toggleReviewed = (characterId: UUID) => {
    setContent((previous) => ({
      reviewedCharacterIds: previous.reviewedCharacterIds.includes(characterId)
        ? previous.reviewedCharacterIds.filter((id) => id !== characterId)
        : [...previous.reviewedCharacterIds, characterId],
    }));
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
      await completeStep.mutateAsync({ projectId, step: 5, overrides: [...ignored] });
      await navigate({ to: "/plan" });
    } catch (cause) {
      if (cause instanceof StepBlockedError) setBlocked([...cause.issues]);
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="sl-card flex flex-col gap-2 p-5">
        <p className="text-sm text-muted">{messages.step5.lead}</p>
        <p className="text-xs tracking-wide text-muted uppercase">
          {format(messages.step5.progress, {
            done: content.reviewedCharacterIds.length,
            total: list.length,
          })}
        </p>
      </section>

      {ordered.length === 0 ? (
        <p className="text-sm text-muted">{messages.step5.empty}</p>
      ) : (
        ordered.map((character) => (
          <StorylineCard
            key={character.id}
            projectId={projectId}
            character={character}
            major={majors.includes(character.id)}
            reviewed={content.reviewedCharacterIds.includes(character.id)}
            onToggleReviewed={toggleReviewed}
          />
        ))
      )}

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

      <PromptsSheet open={promptsOpen} step={5} onClose={() => setPromptsOpen(false)} />
    </div>
  );
}

/** One character's storyline; autosaves straight into `Character.storyline`. */
function StorylineCard({
  projectId,
  character,
  major,
  reviewed,
  onToggleReviewed,
}: {
  projectId: UUID;
  character: CharacterSummary;
  major: boolean;
  reviewed: boolean;
  onToggleReviewed: (characterId: UUID) => void;
}) {
  const [storyline, setStoryline] = useState<RichText>(character.storyline);
  const update = useUpdateCharacter();

  useAutosave(storyline, async (value) => {
    try {
      await update.mutateAsync({
        projectId,
        characterId: character.id,
        patch: { storyline: value },
      });
      return true;
    } catch {
      return false;
    }
  });

  return (
    <section className="sl-card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: character.color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{character.name}</span>
        {major ? <span className="sl-chip">{messages.step5.majorChip}</span> : null}
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={() => onToggleReviewed(character.id)}
          />
          {messages.step5.reviewed}
        </label>
      </div>
      <RichTextEditor
        initial={character.storyline}
        ariaLabel={messages.step5.storylinePlaceholder}
        onChange={setStoryline}
      />
    </section>
  );
}
