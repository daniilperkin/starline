import {
  blockingIssues,
  CHARACTER_ROLES,
  type CharacterDraft,
  type CharacterSummary,
  extractNameCandidatesFromTexts,
  messages,
  type SnowflakeStepRow,
  STEP2_PARTS,
  type Step1Content,
  type Step2Content,
  type Step3Content,
  StepBlockedError,
  type UUID,
  type ValidationIssue,
  validateStep3,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useMemo, useState } from "react";
import { draftOf, patchOf, toContextInfo } from "./characterDraft";
import {
  useCharacters,
  useCompleteStep,
  useCreateCharacter,
  useSaveStep,
  useSteps,
  useUpdateCharacter,
} from "./data";
import { ExtractSheet } from "./ExtractSheet";
import { IssueList } from "./IssueList";
import { PromptsSheet } from "./PromptsSheet";
import { useAutosave } from "./useAutosave";

/** Step 3 — character summaries: one card per character; majors flagged; extraction trigger. */
export function Step3Editor({ projectId, row }: { projectId: UUID; row: SnowflakeStepRow }) {
  const [content, setContent] = useState<Step3Content>(row.content as Step3Content);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set(row.overrides));
  const [blocked, setBlocked] = useState<readonly ValidationIssue[]>([]);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [newName, setNewName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const navigate = useNavigate();

  const characters = useCharacters(projectId);
  const steps = useSteps(projectId);
  const create = useCreateCharacter();
  const saveStep = useSaveStep();
  const completeStep = useCompleteStep();

  const list = characters.data ?? [];

  const flush = useAutosave(content, async (value) => {
    try {
      await saveStep.mutateAsync({ projectId, step: 3, content: value });
      return true;
    } catch {
      return false;
    }
  });

  const issues = useMemo(
    () => validateStep3(content, { characters: list.map(toContextInfo) }),
    [content, list],
  );
  const errors = blockingIssues(issues);

  const toggleMajor = (characterId: UUID) => {
    setContent((previous) => ({
      ...previous,
      majorCharacterIds: previous.majorCharacterIds.includes(characterId)
        ? previous.majorCharacterIds.filter((id) => id !== characterId)
        : [...previous.majorCharacterIds, characterId],
    }));
  };

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0) return;
    setNewName("");
    await create.mutateAsync({ projectId, name }).catch(() => undefined);
  };

  const openExtraction = () => {
    const contentOf = (stepNumber: number) =>
      steps.data?.find((candidate) => candidate.step === stepNumber)?.content ?? null;
    const step1 = contentOf(1) as Step1Content | null;
    const step2 = contentOf(2) as Step2Content | null;
    const texts = [step1?.sentence ?? "", ...(step2 ? STEP2_PARTS.map((part) => step2[part]) : [])];
    const existing = list.flatMap((character) => [character.name, ...character.aliases]);
    setCandidates(extractNameCandidatesFromTexts(texts, existing));
  };

  const onExtractConfirm = async (names: string[]) => {
    setExtracting(true);
    try {
      for (const name of names) {
        await create.mutateAsync({ projectId, name }).catch(() => undefined);
      }
    } finally {
      setExtracting(false);
      setCandidates(null);
    }
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
      await completeStep.mutateAsync({ projectId, step: 3, overrides: [...ignored] });
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
        <p className="text-sm text-muted">{messages.step3.lead}</p>
        <form className="flex gap-2" onSubmit={(event) => void onAdd(event)}>
          <input
            className="sl-input flex-1"
            placeholder={messages.step3.addPlaceholder}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            aria-label={messages.step3.addPlaceholder}
          />
          <button
            type="submit"
            className="sl-btn"
            aria-label={messages.step3.addButton}
            disabled={newName.trim().length === 0}
          >
            +
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="sl-btn" onClick={openExtraction}>
            ✦ {messages.step3.extractButton}
          </button>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={content.skipped}
              onChange={(event) => setContent({ ...content, skipped: event.target.checked })}
            />
            {messages.step3.skipToggle}
          </label>
        </div>
      </section>

      {list.length === 0 ? (
        <p className="text-sm text-muted">{messages.step3.empty}</p>
      ) : (
        list.map((character) => (
          <CharacterCard
            key={character.id}
            projectId={projectId}
            character={character}
            major={content.majorCharacterIds.includes(character.id)}
            onToggleMajor={toggleMajor}
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

      <PromptsSheet open={promptsOpen} step={3} onClose={() => setPromptsOpen(false)} />
      {candidates !== null ? (
        <ExtractSheet
          candidates={candidates}
          busy={extracting}
          onConfirm={(names) => void onExtractConfirm(names)}
          onClose={() => setCandidates(null)}
        />
      ) : null}
    </div>
  );
}

/** One character card; its fields autosave straight to the character row. */
function CharacterCard({
  projectId,
  character,
  major,
  onToggleMajor,
}: {
  projectId: UUID;
  character: CharacterSummary;
  major: boolean;
  onToggleMajor: (characterId: UUID) => void;
}) {
  const [draft, setDraft] = useState<CharacterDraft>(() => draftOf(character));
  const update = useUpdateCharacter();

  useAutosave(draft, async (value) => {
    const patch = patchOf(value);
    if (patch === null) return true;
    try {
      await update.mutateAsync({ projectId, characterId: character.id, patch });
      return true;
    } catch {
      return false;
    }
  });

  const set = <K extends keyof CharacterDraft>(key: K, value: CharacterDraft[K]) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
  };

  const labelClass = "text-xs font-medium tracking-wide text-muted uppercase";

  return (
    <section className="sl-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: draft.color }}
          aria-hidden="true"
        />
        <input
          className="sl-input min-w-0 flex-1"
          value={draft.name}
          aria-label={messages.dossier.name}
          placeholder={messages.dossier.name}
          onChange={(event) => set("name", event.target.value)}
        />
        <select
          className="sl-input"
          value={draft.role}
          aria-label={messages.dossier.role}
          onChange={(event) => set("role", event.target.value as CharacterDraft["role"])}
        >
          {CHARACTER_ROLES.map((role) => (
            <option key={role} value={role}>
              {messages.roles[role]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={major} onChange={() => onToggleMajor(character.id)} />
          {messages.step3.majorToggle}
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["motivation", "goal", "conflict", "epiphany"] as const).map((field) => (
          <div key={field}>
            <label className={labelClass} htmlFor={`${character.id}-${field}`}>
              {messages.dossier[field]}
            </label>
            <textarea
              id={`${character.id}-${field}`}
              className="sl-textarea mt-1"
              rows={2}
              value={draft[field]}
              onChange={(event) => set(field, event.target.value)}
            />
          </div>
        ))}
      </div>

      <div>
        <label className={labelClass} htmlFor={`${character.id}-one-line`}>
          {messages.dossier.oneLine}
        </label>
        <input
          id={`${character.id}-one-line`}
          className="sl-input mt-1"
          value={draft.oneLine}
          onChange={(event) => set("oneLine", event.target.value)}
        />
      </div>
    </section>
  );
}
