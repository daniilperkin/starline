import {
  type BacklinkSource,
  format,
  messages,
  type PossibleMention,
  plural,
  type UUID,
} from "@starline/core";
import { useCallback, useState } from "react";

import { useBacklinks, useLinkMention, usePossibleMentions, useUnlinkMention } from "./data";
import { useUndoStore } from "./undo";

/**
 * Backlinks + possible mentions (PLAN slice 7, spec §3.9 `mention`).
 *
 * "Mentioned in N places" reads the mirror every rich-text save maintains; "Possible mentions"
 * lists plain-text occurrences that are not linked yet and rewrites them into chips with one
 * command (one transaction, one undo step — the toast runs the exact inverse).
 */

const SOURCE_GLYPHS: Record<string, string> = {
  character: "◍",
  lore: "✧",
  scene: "▤",
  chapter: "❖",
  note: "✎",
};

export interface BacklinksPanelProps {
  projectId: UUID | null;
  targetType: "lore" | "character";
  targetId: UUID | null;
  /** Opens the source entity (scene sheet, lore sheet, character screen). */
  onNavigate: (source: BacklinkSource | PossibleMention) => void;
  /** Fired after a link rewrite so the host can refresh its own views. */
  onLinked?: () => void;
}

export function BacklinksPanel({
  projectId,
  targetType,
  targetId,
  onNavigate,
  onLinked,
}: BacklinksPanelProps) {
  const backlinks = useBacklinks(projectId, targetType, targetId);
  const possible = usePossibleMentions(projectId, targetType, targetId);
  const link = useLinkMention();
  const unlink = useUnlinkMention();
  const pushUndo = useUndoStore((state) => state.push);
  const [busy, setBusy] = useState<string | null>(null);

  const linkOne = useCallback(
    async (row: PossibleMention, all: boolean) => {
      if (!projectId || !targetId) return;
      setBusy(`${row.sourceType}:${row.sourceId}:${all ? "all" : "one"}`);
      try {
        const args = {
          projectId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          field: row.field,
          targetType,
          targetId,
        };
        const result = await link.mutateAsync(args);
        if (result.linked > 0) {
          pushUndo(
            result.linked > 1
              ? plural(messages.possible.linkedMany, result.linked)
              : messages.possible.linked,
            async () => {
              await unlink.mutateAsync(args);
            },
          );
        }
        onLinked?.();
      } finally {
        setBusy(null);
      }
    },
    [link, onLinked, projectId, pushUndo, targetId, targetType, unlink],
  );

  const sources = backlinks.data?.sources ?? [];
  const total = backlinks.data?.totalOccurrences ?? 0;
  const possibleRows = possible.data ?? [];

  return (
    <section
      className="sl-backlinks"
      aria-label={plural(messages.backlinks.heading, sources.length)}
    >
      <h3 className="sl-label">{plural(messages.backlinks.heading, sources.length)}</h3>

      {backlinks.isLoading ? (
        <p className="text-xs text-muted">{messages.backlinks.loading}</p>
      ) : null}

      {!backlinks.isLoading && sources.length === 0 ? (
        <div className="sl-empty">
          <p className="text-sm">{messages.backlinks.none}</p>
          <p className="mt-1 text-xs text-muted">{messages.backlinks.noneHint}</p>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <ul className="sl-backlink-list" data-testid="sl-backlinks">
          {sources.map((source) => (
            <li key={`${source.sourceType}:${source.sourceId}:${source.field}`}>
              <button
                type="button"
                className="sl-backlink-row"
                data-source-type={source.sourceType}
                onClick={() => onNavigate(source)}
              >
                <span className="sl-search-glyph" aria-hidden="true">
                  {SOURCE_GLYPHS[source.sourceType] ?? "•"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sl-search-title">{source.title}</span>
                  <span className="sl-search-detail">
                    {source.detail}
                    {source.count > 1 ? ` · ${source.count}×` : ""}
                  </span>
                  {source.snippet ? (
                    <span className="sl-search-snippet">{source.snippet}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {backlinks.data?.truncated ? (
        <p className="text-xs text-muted">
          {format(messages.backlinks.truncated, { shown: sources.length })}
        </p>
      ) : null}

      {possibleRows.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="sl-label mb-0">
            {format(messages.possible.heading, { count: possibleRows.length })}
          </h3>
          <p className="text-xs text-muted">{messages.possible.hint}</p>
          <ul className="sl-backlink-list" data-testid="sl-possible-mentions">
            {possibleRows.map((row) => (
              <li
                key={`${row.sourceType}:${row.sourceId}:${row.field}`}
                className="sl-possible-row"
              >
                <button
                  type="button"
                  className="sl-backlink-row min-w-0 flex-1"
                  data-source-type={row.sourceType}
                  onClick={() => onNavigate(row)}
                >
                  <span className="sl-search-glyph" aria-hidden="true">
                    {SOURCE_GLYPHS[row.sourceType] ?? "•"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sl-search-title">{row.title}</span>
                    <span className="sl-search-detail">
                      {row.detail}
                      {row.occurrences > 1 ? ` · ${row.occurrences}×` : ""}
                    </span>
                    {row.snippet ? <span className="sl-search-snippet">{row.snippet}</span> : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="sl-btn-small shrink-0"
                  disabled={busy !== null}
                  onClick={() => void linkOne(row, false)}
                >
                  {messages.possible.link}
                </button>
              </li>
            ))}
          </ul>
          {possibleRows.length > 1 ? (
            <button
              type="button"
              className="sl-btn-small self-start"
              disabled={busy !== null}
              onClick={async () => {
                for (const row of possibleRows) await linkOne(row, true);
              }}
            >
              {messages.possible.linkAll}
            </button>
          ) : null}
        </div>
      ) : null}

      {total > 0 && possibleRows.length === 0 ? (
        <p className="text-xs text-muted">{messages.possible.none}</p>
      ) : null}
    </section>
  );
}
