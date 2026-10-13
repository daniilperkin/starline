import { format, messages, type UUID } from "@starline/core";
import { useMemo, useState } from "react";
import { useLoreEntries, useSetSceneLore } from "./data";

/**
 * "Lore touched" for a scene (spec §4.3.3): the entries this scene leans on, as chips, plus a
 * searchable popup to attach more. The data layer has had `scene_lore` and `scene.setLore` since
 * the schema landed — this is the picker the command's own comment promised, and it is what makes
 * backlinks from lore to scenes real.
 *
 * Search rather than a plain list because a reference project holds four hundred entries, and a
 * scene usually needs three of them.
 */
export function SceneLorePicker({
  projectId,
  sceneId,
  selected,
}: {
  projectId: UUID;
  sceneId: UUID;
  selected: UUID[];
}) {
  const entries = useLoreEntries(projectId);
  const setLore = useSetSceneLore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(
    () => new Map((entries.data ?? []).map((entry) => [entry.id, entry])),
    [entries.data],
  );
  const chosen = selected
    .map((id) => byId.get(id))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
  const needle = query.trim().toLowerCase();
  const candidates = (entries.data ?? [])
    .filter((entry) => !selected.includes(entry.id))
    .filter(
      (entry) =>
        needle.length === 0 ||
        entry.name.toLowerCase().includes(needle) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(needle)),
    )
    .slice(0, 12);

  const apply = (loreIds: UUID[]) => setLore.mutate({ projectId, sceneId, loreIds });

  return (
    <div className="flex flex-col gap-1">
      <span className="sl-label">{messages.sceneSheet.lore}</span>
      <div className="sl-tag-chips">
        {chosen.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="sl-chip"
            data-testid="sl-lore-chip"
            aria-label={format(messages.sceneSheet.loreRemove, { name: entry.name })}
            onClick={() => apply(selected.filter((id) => id !== entry.id))}
          >
            ✧ {entry.name}
          </button>
        ))}
        <button
          type="button"
          className="sl-chip sl-chip-add"
          aria-expanded={open}
          data-testid="sl-lore-add"
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true">＋</span> {messages.sceneSheet.loreAdd}
        </button>
      </div>
      {chosen.length === 0 && !open ? (
        <p className="text-xs text-muted">{messages.sceneSheet.loreEmpty}</p>
      ) : null}

      {open ? (
        <div className="sl-tag-popup" data-testid="sl-lore-popup">
          <input
            className="sl-input"
            type="search"
            value={query}
            placeholder={messages.sceneSheet.loreSearch}
            aria-label={messages.sceneSheet.loreSearch}
            data-testid="sl-lore-search"
            onChange={(event) => setQuery(event.target.value)}
          />
          {candidates.length === 0 ? (
            <p className="mt-2 text-xs text-muted">{messages.sceneSheet.loreNoResults}</p>
          ) : (
            <div className="sl-tag-options">
              {candidates.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="sl-tag-option"
                  data-testid="sl-lore-option"
                  onClick={() => {
                    // Stays open: a scene usually touches several entries, and reopening the
                    // popup per entry is the difference between a picker and a chore.
                    apply([...selected, entry.id]);
                    setQuery("");
                  }}
                >
                  <span className="sl-dot" aria-hidden="true" />
                  {entry.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
