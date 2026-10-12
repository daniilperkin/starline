import {
  computeStaleSteps,
  format,
  messages,
  plural,
  progressOf,
  type RecentEntity,
  type SceneContextInfo,
  type SnowflakeStepNumber,
  type SnowflakeStepRow,
  STEP_NUMBERS,
  validateStep,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  useConsistencyChecks,
  useContinueTarget,
  useCreateProject,
  useDashboardStats,
  useProjects,
  useSceneTree,
  useSnapshots,
  useStaleIdeas,
  useSteps,
  useTakeSnapshot,
  useTrash,
} from "./data";
import { formatNumber } from "./locale";
import { useSessionStore } from "./session";
import { closeLibrary } from "./storage";
import { ThemeButton } from "./ThemeButton";
import { relativeTime } from "./time";

export function PlanScreen() {
  const session = useSessionStore((state) => state.session);
  const setSession = useSessionStore((state) => state.setSession);
  const navigate = useNavigate();
  const projects = useProjects();
  const createProject = useCreateProject();
  const steps = useSteps(projects.data?.[0]?.id ?? null);
  const tree = useSceneTree(projects.data?.[0]?.id ?? null);
  const stats = useDashboardStats(projects.data?.[0]?.id ?? null);
  const continueTarget = useContinueTarget(projects.data?.[0]?.id ?? null);
  const staleIdeas = useStaleIdeas(projects.data?.[0]?.id ?? null);
  const snapshots = useSnapshots();
  const takeSnapshot = useTakeSnapshot();
  const trash = useTrash(projects.data?.[0]?.id ?? null);
  const checks = useConsistencyChecks(projects.data?.[0]?.id ?? null);
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

  const project = projects.data?.[0] ?? null;
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
                  createProject.mutate(title.trim());
                }
              }}
            />
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              disabled={createProject.isPending || title.trim().length === 0}
              onClick={() => createProject.mutate(title.trim())}
            >
              {messages.plan.createButton}
            </button>
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
