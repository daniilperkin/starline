import { issueMessage, messages, type ValidationIssue } from "@starline/core";

/** Blocking errors first, then warnings with an ignore toggle (spec §3.4.1 soft gating). */
export function IssueList({
  issues,
  ignored,
  onToggleIgnore,
}: {
  issues: readonly ValidationIssue[];
  ignored: ReadonlySet<string>;
  onToggleIgnore: (code: string) => void;
}) {
  const blocking = issues.filter((issue) => issue.severity === "error");
  const rest = issues.filter((issue) => issue.severity !== "error");
  if (issues.length === 0) return null;

  return (
    <section className="sl-card p-4" aria-live="polite">
      {blocking.length > 0 ? (
        <>
          <h2 className="text-xs font-medium tracking-wide text-danger uppercase">
            {messages.plan.blockersHeading}
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {blocking.map((issue) => (
              <li key={`${issue.code}-${issue.field ?? ""}`} className="text-sm text-danger">
                • {issueMessage(issue.code)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {rest.length > 0 ? (
        <>
          <h2 className="mt-3 text-xs font-medium tracking-wide text-muted uppercase">
            {messages.plan.warningsHeading}
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {rest.map((issue) => (
              <li
                key={`${issue.code}-${issue.field ?? ""}`}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <span className={ignored.has(issue.code) ? "text-muted line-through" : ""}>
                  • {issueMessage(issue.code)}
                </span>
                <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={ignored.has(issue.code)}
                    onChange={() => onToggleIgnore(issue.code)}
                  />
                  {messages.plan.ignore}
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
