import { format, messages, type SnowflakeStepNumber, STEP_NUMBERS } from "@starline/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { ComingSoonScreen } from "./ComingSoonScreen";
import { useProjects, useSteps } from "./data";
import { Step1Editor } from "./Step1Editor";
import { Step2Editor } from "./Step2Editor";

export function StepScreen() {
  const { step: stepParam } = useParams({ from: "/plan/step/$step" });
  const navigate = useNavigate();
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;
  const steps = useSteps(project?.id ?? null);
  const step = Number.parseInt(stepParam, 10);
  const valid = STEP_NUMBERS.some((candidate) => candidate === step);
  const row = steps.data?.find((candidate) => candidate.step === step) ?? null;

  useEffect(() => {
    if (!valid) void navigate({ to: "/plan" });
  }, [valid, navigate]);

  if (!valid) return null;
  const stepNumber = step as SnowflakeStepNumber;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <header className="flex items-center gap-3">
        <button
          type="button"
          className="sl-btn"
          aria-label={messages.plan.previous}
          onClick={() => void navigate({ to: "/plan" })}
        >
          ←
        </button>
        <div className="min-w-0">
          <p className="text-xs tracking-wide text-muted uppercase">
            {format(messages.plan.stepOf, { n: stepNumber })}
          </p>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {messages.steps[stepNumber]}
          </h1>
        </div>
      </header>

      {project !== null && row !== null ? (
        stepNumber === 1 ? (
          <Step1Editor key={row.id} projectId={project.id} row={row} />
        ) : stepNumber === 2 ? (
          <Step2Editor key={row.id} projectId={project.id} row={row} />
        ) : (
          <ComingSoonScreen label={messages.steps[stepNumber]} />
        )
      ) : (
        <p className="text-sm text-muted">{messages.common.loading}</p>
      )}
    </div>
  );
}
