import {
  computeStaleSteps,
  dailyPrompt,
  dayKey,
  format,
  messages,
  plural,
  progressOf,
  type RecentEntity,
  type SceneContextInfo,
  type SnowflakeStepNumber,
  type SnowflakeStepRow,
  STEP_NUMBERS,
  type StoryForm,
  validateStep,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useActiveProject } from "./active-project";
import {
  useConsistencyChecks,
  useContinueTarget,
  useCreateProject,
  useDashboardStats,
  useSceneStats,
  useSceneTree,
  useSnapshots,
  useStaleIdeas,
  useSteps,
  useTakeSnapshot,
  useTrash,
} from "./data";
import { formatNumber, useLocaleStore } from "./locale";
import { useSessionStore } from "./session";
import { closeLibrary } from "./storage";
import { ThemeButton } from "./ThemeButton";
import { relativeTime } from "./time";

/** The creation flow's vocabulary (S36, spec 4.2 step 3): genre chips (max 8), forms, presets. */
const GENRE_SUGGESTIONS = [
  "Fantasy",
  "Science fiction",
  "Romance",
  "Mystery",
  "Thriller",
  "Horror",
  "Historical",
  "Literary",
  "Adventure",
  "Young adult",
  "Middle grade",
  "New adult",
  "Dystopian",
  "Urban fantasy",
  "Paranormal",
  "Crime",
  "Suspense",
  "Western",
  "Satire",
  "Humor",
  "Drama",
  "Poetry",
  "Memoir",
  "Biography",
  "Non-fiction",
  "Fairy tale",
  "Mythic",
  "Steampunk",
  "Cyberpunk",
  "Space opera",
] as const;

const STORY_FORMS = [
  "novel",
  "novella",
  "short_story",
  "fairy_tale",
  "fanfiction",
  "screenplay_treatment",
] as const;

const WORD_PRESETS = [20000, 50000, 80000, 120000] as const;

/** "112 days left" / "due today" / "9 days over" - the dashboard's countdown (S36). */
function deadlineCountdown(deadline: string): string {
  const target = new Date(`${deadline}T23:59:59`);
  const now = new Date();
  const days = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
  if (days > 1) return format(messages.plan.deadlineDays, { days });
  if (days === 1) return messages.plan.deadlineTomorrow;
  if (days === 0) return messages.plan.deadlineToday;
  return format(messages.plan.deadlineOver, { days: Math.abs(days) });
}

export function PlanScreen() {
  const session = useSessionStore((state) => state.session);
  const setSession = useSessionStore((state) => state.setSession);
  const navigate = useNavigate();
  const createProject = useCreateProject();
  // The creation flow's extras (S36, spec 4.2 step 3): kept beside the title so the whole
  // brief is written in one command.
  const [genres, setGenres] = useState<string[]>([]);
  const [form, setForm] = useState("novel");
  const [targetWords, setTargetWords] = useState<number | null>(50000);
  const [deadline, setDeadline] = useState("");
  const [ideaSeed, setIdeaSeed] = useState("");
  const [customWords, setCustomWords] = useState("");
  const { project: activeProject } = useActiveProject();
  const activeProjectId = activeProject?.id ?? null;
  const steps = useSteps(activeProjectId);
  const tree = useSceneTree(activeProjectId);
  const stats = useDashboardStats(activeProjectId);
  const sceneStatsQuery = useSceneStats(activeProjectId);
  const continueTarget = useContinueTarget(activeProjectId);
  const dashboardWords = sceneStatsQuery.data?.wordsWritten ?? 0;
  const staleIdeas = useStaleIdeas(activeProjectId);
  const snapshots = useSnapshots();
  const takeSnapshot = useTakeSnapshot();
  const trash = useTrash(activeProjectId);
  const checks = useConsistencyChecks(activeProjectId);
  const [title, setTitle] = useState("");
  const [closing, setClosing] = useState(false);

  // Step 8's issues live in the scene table, so the plan list needs the light scene slice.
  const sceneContext: SceneContextInfo[] = useMemo(
    () =>
      (tree.data?.scenes ?? []).map((scene) => ({
        id: scene.id,
        povCharacterId: scene.povCharacterId,
        chapterId: scene.chapterId,
        synopsisWords: scene.synopsis.wordCount,
      })),
    [tree.data],
  );

  if (!session) return null;

  const project = activeProject;
  const progress = progressOf(steps.data ?? []);
  const nextStep = nextStepOf(steps.data ?? []);
  const staleSteps = computeStaleSteps(steps.data ?? []);

  const openStep = (step: SnowflakeStepNumber) => {
    void navigate({ to: "/plan/step/$step", params: { step: String(step) } });
  };

  const openRecent = (entity: RecentEntity) => {
    if (entity.kind === "step" && entity.step !== null) {
      openStep(entity.step);
      return;
    }
    if (entity.kind === "character") {
      void navigate({ to: "/people/$characterId", params: { characterId: entity.id } });
      return;
    }
    void navigate({ to: "/scenes" });
  };

  const step8Complete = steps.data?.some((step) => step.step === 8 && step.status === "complete");

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.plan.heading}</h1>
          <p className="truncate text-sm text-muted">✦ {displayName(session.name)}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ThemeButton />
          <button
            type="button"
            className="sl-btn"
            disabled={closing}
            onClick={() => {
              setClosing(true);
              void closeLibrary(session).then(() => setSession(null));
            }}
          >
            {messages.plan.closeLibrary}
          </button>
        </div>
      </header>

      {project === null ? (
        <section className="sl-card p-5">
          <h2 className="text-sm font-medium text-muted">{messages.plan.createHeading}</h2>
          <p className="mt-1 text-sm text-muted">{messages.plan.createHint}</p>
          <div className="mt-3 flex gap-2">
            <input
              className="sl-input flex-1"
              placeholder={messages.plan.titlePlaceholder}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && title.trim() && !createProject.isPending) {
                  createProject.mutate({
                    title: title.trim(),
                    genres,
                    form: form as StoryForm,
                    targetWordCount: targetWords,
                    deadline: deadline.length > 0 ? deadline : null,
                    ideaSeed,
                  });
                }
              }}
            />
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              disabled={createProject.isPending || title.trim().length === 0}
              onClick={() =>
                createProject.mutate({
                  title: title.trim(),
                  genres,
                  form: form as StoryForm,
                  targetWordCount: targetWords,
                  deadline: deadline.length > 0 ? deadline : null,
                  ideaSeed,
                })
              }
            >
              {messages.plan.createButton}
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3" data-testid="sl-create-extras">
            <div className="flex flex-wrap gap-2" data-testid="sl-create-genres">
              {GENRE_SUGGESTIONS.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  className="sl-chip"
                  data-active={genres.includes(genre)}
                  onClick={() =>
                    setGenres((current) =>
                      current.includes(genre)
                        ? current.filter((entry) => entry !== genre)
                        : current.length < 8
                          ? [...current, genre]
                          : current,
                    )
                  }
                >
                  {genre}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="sl-field">
                <label className="sl-label" htmlFor="sl-create-form">
                  {messages.plan.formLabel}
                </label>
                <select
                  id="sl-create-form"
                  className="sl-select"
                  data-testid="sl-create-form"
                  value={form}
                  onChange={(event) => setForm(event.target.value)}
                >
                  {STORY_FORMS.map((option) => (
                    <option key={option} value={option}>
                      {messages.plan.forms[option]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sl-field">
                <label className="sl-label" htmlFor="sl-create-words">
                  {messages.plan.wordsLabel}
                </label>
                <select
                  id="sl-create-words"
                  className="sl-select"
                  data-testid="sl-create-words"
                  value={targetWords === null ? "custom" : String(targetWords)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTargetWords(value === "custom" ? null : Number(value));
                  }}
                >
                  {WORD_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {formatNumber(preset)}
                    </option>
                  ))}
                  <option value="custom">{messages.plan.wordsCustom}</option>
                </select>
              </div>
              {targetWords === null ? (
                <div className="sl-field">
                  <label className="sl-label" htmlFor="sl-create-custom">
                    {messages.plan.wordsLabel}
                  </label>
                  <input
                    id="sl-create-custom"
                    type="number"
                    min={1000}
                    step={1000}
                    className="sl-input"
                    data-testid="sl-create-custom"
                    value={customWords}
                    onChange={(event) => {
                      setCustomWords(event.target.value);
                      const parsed = Number(event.target.value);
                      if (Number.isFinite(parsed) && parsed > 0) setTargetWords(parsed);
                    }}
                  />
                </div>
              ) : null}
              <div className="sl-field">
                <label className="sl-label" htmlFor="sl-create-deadline">
                  {messages.plan.deadlineLabel}
                </label>
                <input
                  id="sl-create-deadline"
                  type="date"
                  className="sl-input"
                  data-testid="sl-create-deadline"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                />
              </div>
            </div>
            <div className="sl-field">
              <label className="sl-label" htmlFor="sl-create-seed">
                {messages.plan.seedLabel}
              </label>
              <textarea
                id="sl-create-seed"
                rows={2}
                className="sl-textarea"
                data-testid="sl-create-seed"
                placeholder={messages.plan.seedPlaceholder}
                value={ideaSeed}
                onChange={(event) => setIdeaSeed(event.target.value)}
              />
            </div>
          </div>

          {/* Settings must be reachable before a story exists: the cloud switch, the language and
              the appearance toggle all work without a project, and hunting for them behind a story
              that has not been created yet is exactly the kind of dead end this avoids. */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="sl-btn-small"
              data-testid="sl-open-settings"
              onClick={() => void navigate({ to: "/settings" })}
            >
              {messages.settings.open}
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="sl-card flex items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight">{project.title}</h2>
              <p className="mt-1 text-sm text-muted">
                {format(messages.plan.stepsComplete, {
                  done: progress.done,
                  total: progress.total,
                })}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="sl-dash-meta">
                <span className="sl-chip">
                  {messages.plan.forms[project.form as StoryForm] ?? project.form}
                </span>
                {project.genres.slice(0, 4).map((genre) => (
                  <span key={genre} className="sl-chip">
                    {genre}
                  </span>
                ))}
                {project.deadline !== null && project.deadline.length > 0 ? (
                  <span className="text-xs text-muted" data-testid="sl-dash-deadline">
                    {deadlineCountdown(project.deadline)}
                  </span>
                ) : null}
              </div>
              {project.targetWordCount !== null ? (
                <p className="mt-2 text-xs text-muted" data-testid="sl-dash-words">
                  {format(messages.plan.wordsProgress, {
                    written: formatNumber(dashboardWords),
                    target: formatNumber(project.targetWordCount),
                  })}
                </p>
              ) : null}
            </div>
            <ProgressRing done={progress.done} total={progress.total} />
          </section>

          {continueTarget.data ? (
            <section
              className="sl-card flex items-center justify-between gap-4 p-4"
              data-testid="sl-continue-card"
            >
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-muted">{messages.write.continueHeading}</h2>
                <p className="mt-1 truncate text-base font-semibold tracking-tight">
                  {continueTarget.data.title || messages.write.untitled}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {continueTarget.data.reason === "last"
                    ? messages.write.continueLast
                    : messages.write.continueNext}
                  {continueTarget.data.wordCount > 0
                    ? ` · ${plural(messages.write.continueWords, continueTarget.data.wordCount, {
                        words: formatNumber(continueTarget.data.wordCount),
                      })}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                className="sl-btn sl-btn-primary shrink-0"
                data-testid="sl-continue-write"
                onClick={() =>
                  void navigate({
                    to: "/write/$sceneId",
                    params: { sceneId: (continueTarget.data as { sceneId: string }).sceneId },
                  })
                }
              >
                {messages.write.action}
              </button>
            </section>
          ) : null}

          <DailyCard />

          {staleIdeas.data && staleIdeas.data.length > 0 ? (
            <section className="sl-card flex flex-col gap-2 p-4" data-testid="sl-revisit-card">
              <h2 className="text-sm font-medium text-muted">{messages.notes.revisit}</h2>
              <p className="text-xs text-muted">{messages.notes.revisitHint}</p>
              <ul className="flex flex-col gap-1">
                {staleIdeas.data.map((idea) => (
                  <li key={idea.id}>
                    <button
                      type="button"
                      className="sl-recent-row"
                      onClick={() => void navigate({ to: "/notes" })}
                    >
                      <span className="min-w-0 flex-1 truncate text-left text-sm">
                        {idea.title}
                      </span>
                      <span className="text-xs text-muted">
                        {plural(messages.notes.revisitAge, idea.ageDays)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="sl-card flex flex-col gap-3 p-4">
            {stats.data ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="sl-chip">
                  {format(messages.dashboard.counts, {
                    characters: stats.data.characterCount,
                    scenes: stats.data.sceneCount,
                  })}
                </span>
                <span className="sl-chip">
                  {stats.data.writtenWords > 0
                    ? format(messages.dashboard.wordsWritten, {
                        written: formatNumber(stats.data.writtenWords),
                        target: formatNumber(
                          stats.data.targetWordCount ?? stats.data.estimatedWords,
                        ),
                      })
                    : stats.data.targetWordCount !== null
                      ? format(messages.dashboard.words, {
                          est: formatNumber(stats.data.estimatedWords),
                          target: formatNumber(stats.data.targetWordCount),
                        })
                      : format(messages.dashboard.wordsNoTarget, {
                          est: formatNumber(stats.data.estimatedWords),
                        })}
                </span>
                {step8Complete ? (
                  <span className="sl-chip">✦ {messages.dashboard.planned}</span>
                ) : null}
              </div>
            ) : null}

            {stats.data && stats.data.recent.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium text-muted">
                  {messages.dashboard.continueHeading}
                </h3>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {stats.data.recent.map((entity) => (
                    <li key={`${entity.kind}:${entity.id}`}>
                      <button
                        type="button"
                        className="sl-recent-row"
                        onClick={() => openRecent(entity)}
                      >
                        <span className="min-w-0 flex-1 truncate text-left text-sm">
                          {entity.kind === "step" && entity.step !== null
                            ? `${entity.step}. ${messages.steps[entity.step]}`
                            : entity.label.trim() || messages.dashboard.sceneFallback}
                        </span>
                        <span className="shrink-0 text-xs text-muted">
                          {relativeTime(entity.updatedAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="border-t border-line pt-3">
              <p className="text-xs text-muted">
                {snapshots.data && snapshots.data.length > 0
                  ? format(messages.snapshot.last, {
                      when: relativeTime(snapshots.data[0]?.createdAt ?? null),
                    })
                  : messages.snapshot.none}
              </p>
              {/* The status line gets its own row: five action buttons in one flex row squeezed
                  it to zero width on a phone (the E2E found it as "resolved to hidden"). */}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="sl-btn-small"
                  disabled={takeSnapshot.isPending}
                  onClick={() => takeSnapshot.mutate("manual")}
                >
                  {takeSnapshot.isPending ? messages.snapshot.taking : messages.snapshot.now}
                </button>
                <button
                  type="button"
                  className="sl-btn-small"
                  data-testid="sl-open-backups"
                  onClick={() => void navigate({ to: "/backups" })}
                >
                  {messages.backups.open}
                </button>
                <button
                  type="button"
                  className="sl-btn-small"
                  data-testid="sl-open-export"
                  onClick={() => void navigate({ to: "/export" })}
                >
                  {messages.export.open}
                </button>
                <button
                  type="button"
                  className="sl-btn-small"
                  onClick={() => void navigate({ to: "/trash" })}
                >
                  {trash.data && trash.data.length > 0
                    ? `${messages.trash.open} · ${trash.data.length}`
                    : messages.trash.open}
                </button>
                <button
                  type="button"
                  className="sl-btn-small"
                  data-testid="sl-open-settings"
                  onClick={() => void navigate({ to: "/settings" })}
                >
                  {messages.settings.open}
                </button>
                <button
                  type="button"
                  className="sl-btn-small"
                  data-testid="sl-checks-open"
                  onClick={() => void navigate({ to: "/checks" })}
                >
                  {checks.data && checks.data.length > 0
                    ? `${messages.checks.open} · ${checks.data.reduce((sum, check) => sum + check.items.length, 0)}`
                    : messages.checks.open}
                </button>
              </div>
            </div>
          </section>

          {nextStep !== null ? (
            <button
              type="button"
              className="sl-btn sl-btn-primary w-full"
              onClick={() => openStep(nextStep)}
            >
              {messages.plan.continueHint}
            </button>
          ) : null}

          <ul className="flex flex-col gap-2">
            {STEP_NUMBERS.map((stepNumber) => {
              const row = steps.data?.find((step) => step.step === stepNumber) ?? null;
              return (
                <li key={stepNumber}>
                  <StepRow
                    stepNumber={stepNumber}
                    row={row}
                    stale={staleSteps.has(stepNumber)}
                    sceneContext={sceneContext}
                    onOpen={() => openStep(stepNumber)}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function StepRow({
  stepNumber,
  row,
  stale,
  sceneContext,
  onOpen,
}: {
  stepNumber: SnowflakeStepNumber;
  row: SnowflakeStepRow | null;
  stale: boolean;
  sceneContext: readonly SceneContextInfo[];
  onOpen: () => void;
}) {
  const status = row?.status ?? "not_started";
  const glyph = status === "complete" ? "●" : status === "in_progress" ? "◐" : "○";
  // Issue counts only matter once a step has content — a not-started step is not "warned".
  const issues =
    row && status !== "not_started"
      ? validateStep(stepNumber, row.content, { scenes: sceneContext })
      : [];

  return (
    <button type="button" className="sl-step-row" onClick={onOpen}>
      <span className="sl-step-glyph" data-status={status} aria-hidden="true">
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {stepNumber}. {messages.steps[stepNumber]}
        </span>
        <span className="block text-xs text-muted">{messages.plan.status[status]}</span>
      </span>
      {stale ? <span className="sl-chip">{messages.plan.stale}</span> : null}
      {issues.length > 0 ? (
        <span className="sl-chip" title={messages.plan.hasWarnings}>
          ⚠ {issues.length}
        </span>
      ) : null}
      <span aria-hidden="true" className="text-muted">
        ›
      </span>
    </button>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const label = format(messages.plan.stepsComplete, { done, total });
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={label}>
      <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--sl-border)" strokeWidth="6" />
      {done > 0 ? (
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="var(--sl-primary)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(done / total) * circumference} ${circumference}`}
          transform="rotate(-90 32 32)"
        />
      ) : null}
    </svg>
  );
}

function nextStepOf(steps: readonly SnowflakeStepRow[]): SnowflakeStepNumber | null {
  const ordered = [...steps].sort((a, b) => a.step - b.step);
  const inProgress = ordered.find((step) => step.status === "in_progress");
  if (inProgress) return inProgress.step;
  const firstOpen = ordered.find((step) => step.status !== "complete");
  return firstOpen?.step ?? null;
}

function displayName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * The offline daily inspiration card (slice 16). One reflective question from the bundled prompt
 * library, chosen deterministically from the local calendar date — the same day always shows the
 * same question, nothing is fetched, and nothing needs saving to make "today" mean today. Hiding
 * it records only that one date, so tomorrow's question appears without any further bookkeeping.
 */
const DAILY_KEY = "starline.daily.dismissed";

function DailyCard() {
  const locale = useLocaleStore((state) => state.locale);
  const today = useMemo(() => dailyPrompt(new Date(), locale), [locale]);
  const [dismissed, setDismissed] = useState(() => readDismissed() === dayKey(new Date()));

  if (dismissed) return null;

  const hide = () => {
    try {
      localStorage.setItem(DAILY_KEY, dayKey(new Date()));
    } catch {
      // Private mode: hiding lasts for this session, which is the honest behaviour.
    }
    setDismissed(true);
  };

  return (
    <section className="sl-card flex flex-col gap-2 p-4" data-testid="sl-daily-card">
      <h2 className="text-sm font-medium text-muted">{messages.daily.heading}</h2>
      <p className="text-sm" data-testid="sl-daily-question">
        {today.question}
      </p>
      <p className="text-xs text-muted">{format(messages.daily.fromStep, { step: today.step })}</p>
      <button
        type="button"
        className="sl-btn-small self-start"
        data-testid="sl-daily-dismiss"
        onClick={hide}
      >
        {messages.daily.dismiss}
      </button>
    </section>
  );
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DAILY_KEY);
  } catch {
    return null;
  }
}
