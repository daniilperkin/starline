import {
  computeStaleSteps,
  format,
  messages,
  progressOf,
  type SceneContextInfo,
  type SnowflakeStepNumber,
  type SnowflakeStepRow,
  STEP_NUMBERS,
  validateStep,
} from "@starline/core";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCreateProject, useProjects, useSceneTree, useSteps } from "./data";
import { useSessionStore } from "./session";
import { closeLibrary } from "./storage";
import { ThemeButton } from "./ThemeButton";

export function PlanScreen() {
  const session = useSessionStore((state) => state.session);
  const setSession = useSessionStore((state) => state.setSession);
  const navigate = useNavigate();
  const projects = useProjects();
  const createProject = useCreateProject();
  const steps = useSteps(projects.data?.[0]?.id ?? null);
  const tree = useSceneTree(projects.data?.[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [closing, setClosing] = useState(false);

  // Step 8's issues live in the scene table, so the plan list needs the light scene slice.
  const sceneContext: SceneContextInfo[] = useMemo(
    () =>
      (tree.data?.scenes ?? []).map((scene) => ({
        id: scene.id,
        povCharacterId: scene.povCharacterId,
        chapterId: scene.chapterId,
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

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{messages.plan.heading}</h1>
          <p className="truncate text-sm text-muted">✦ {displayName(session.name)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
            Close library
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
