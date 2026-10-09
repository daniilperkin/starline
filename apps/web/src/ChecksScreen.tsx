import { type ConsistencyCheck, format, messages } from "@starline/core";

import { useConsistencyChecks, useProjects } from "./data";
import { useOpenEntity } from "./openEntity";
import { useSessionStore } from "./session";

/**
 * Consistency checks (PLAN slice 7): empty summaries, lore nothing links to, factions without
 * links, scenes with no synopsis, near-duplicate names. Advisory only — nothing here blocks a
 * step or a save (spec §3.4.1 soft gating), and every row links to the entity it is about.
 */

const CHECK_GLYPHS: Record<string, string> = {
  "lore-empty": "✧",
  "character-empty": "◍",
  "lore-unused": "✦",
  "faction-unlinked": "⚑",
  "duplicate-names": "≈",
  "scene-thin": "▤",
};

export function ChecksScreen() {
  const session = useSessionStore((state) => state.session);
  const projects = useProjects();
  const projectId = projects.data?.[0]?.id ?? null;
  const checks = useConsistencyChecks(projectId);
  const openEntity = useOpenEntity();

  if (!session) return null;

  const rows = (checks.data ?? []).filter((check) => check.items.length > 0);
  const total = rows.reduce((sum, check) => sum + check.items.length, 0);

  const labelOf = (check: ConsistencyCheck): string =>
    (messages.checks.names as Record<string, string | undefined>)[check.id] ?? check.label;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{messages.checks.title}</h1>
          <p className="mt-1 text-xs text-muted">{messages.checks.subtitle}</p>
        </div>
        <button
          type="button"
          className="sl-btn-small shrink-0"
          disabled={checks.isFetching}
          onClick={() => void checks.refetch()}
        >
          {messages.checks.refresh}
        </button>
      </header>

      {rows.length === 0 ? (
        <div className="sl-empty" data-testid="sl-checks-empty">
          <p className="text-sm font-medium">{messages.checks.empty}</p>
          <p className="mt-1 text-xs text-muted">{messages.checks.emptyHint}</p>
        </div>
      ) : (
        <p className="text-xs text-muted">{format(messages.checks.total, { count: total })}</p>
      )}

      {rows.map((check) => (
        <section key={check.id} className="sl-card p-4" data-testid={`sl-check-${check.id}`}>
          <div className="flex items-center gap-2">
            <span className="sl-search-glyph" aria-hidden="true">
              {CHECK_GLYPHS[check.id] ?? "•"}
            </span>
            <h2 className="min-w-0 flex-1 text-sm font-semibold">{labelOf(check)}</h2>
            <span className="sl-chip">{check.items.length}</span>
          </div>
          <p className="mt-1 text-xs text-muted">{check.hint}</p>
          <ul className="sl-check-list">
            {check.items.map((item) => (
              <li key={`${item.entityType}:${item.entityId}`}>
                <button
                  type="button"
                  className="sl-backlink-row"
                  data-entity-type={item.entityType}
                  onClick={() => openEntity(item.entityType, item.entityId)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="sl-search-title">{item.title}</span>
                    {item.detail ? <span className="sl-search-detail">{item.detail}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
