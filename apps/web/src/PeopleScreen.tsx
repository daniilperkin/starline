import {
  format,
  type MatrixCell,
  messages,
  type RelationshipEdge,
  relationshipsToCsv,
  type UUID,
} from "@starline/core";
import { Link } from "@tanstack/react-router";
import { type FormEvent, lazy, Suspense, useMemo, useState } from "react";
import { useActiveProject } from "./active-project";
import {
  useCharacters,
  useCreateCharacter,
  useGraphPositions,
  useMergeCharacters,
  useRelationshipCounts,
  useRelationshipMatrix,
  useSceneTree,
  useUnmergeCharacters,
} from "./data";
import { EdgeSheet } from "./relationships/EdgeSheet";
import { GroupSheet } from "./relationships/GroupSheet";
import { RelationshipList } from "./relationships/RelationshipList";
import { useUndoStore } from "./undo";

// Lazy: the matrix pulls react-virtual, the web pulls xyflow + d3-force — the bundle gate keeps
// each route under 150 KiB gz, so neither may land in the People chunk.
const RelationshipMatrix = lazy(() =>
  import("./relationships/RelationshipMatrix").then((module) => ({
    default: module.RelationshipMatrix,
  })),
);
const RelationshipGraph = lazy(() =>
  import("./relationships/RelationshipGraph").then((module) => ({
    default: module.RelationshipGraph,
  })),
);

type Mode = "list" | "matrix" | "graph";

/**
 * People tab (PLAN slice 8, spec §4.2): the character list, plus the three faces of the same
 * relationship data — the editable table (list), the matrix (the fastest way to fill a cast in)
 * and the web (the visual one). Every mode reads one matrix query, so they never disagree.
 */
/** Pinned character ids, per project, in localStorage - a view preference, not story data. */
function pinKey(projectId: UUID | null): string {
  return `starline.characters.pins.${projectId ?? "none"}`;
}

function readPins(projectId: UUID | null): Set<UUID> {
  try {
    const raw = localStorage.getItem(pinKey(projectId));
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as UUID[]) : []);
  } catch {
    return new Set();
  }
}

function writePins(projectId: UUID | null, pins: Set<UUID>) {
  try {
    localStorage.setItem(pinKey(projectId), JSON.stringify([...pins]));
  } catch {
    // Private mode: pins simply do not persist.
  }
}

const ROLE_ORDER: Record<string, number> = {
  protagonist: 0,
  antagonist: 1,
  major: 2,
  supporting: 3,
  minor: 4,
  mentioned: 5,
};

export function PeopleScreen() {
  const { project } = useActiveProject();
  const projectId = project?.id ?? null;
  const characters = useCharacters(projectId);
  const counts = useRelationshipCounts(projectId);
  const matrix = useRelationshipMatrix(projectId);
  const positions = useGraphPositions(projectId);
  const tree = useSceneTree(projectId);
  const create = useCreateCharacter();

  const [mode, setMode] = useState<Mode>("list");
  const [query, setQuery] = useState("");
  const [unconnectedOnly, setUnconnectedOnly] = useState(false);
  const [newName, setNewName] = useState("");
  // The list's depth (S36, spec 4.3.1): sorts, a role filter and pinned characters.
  const [sortBy, setSortBy] = useState<"manual" | "name" | "role" | "scenes">("manual");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [pins, setPins] = useState<Set<UUID>>(() => readPins(projectId));
  const [sheet, setSheet] = useState<{
    edge: RelationshipEdge | null;
    pair?: { sourceId: UUID; targetId: UUID };
  } | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState<UUID | null>(null);
  const [mergeTarget, setMergeTarget] = useState<UUID | null>(null);
  const [merging, setMerging] = useState(false);
  const pushUndo = useUndoStore((state) => state.push);
  const merge = useMergeCharacters();
  const unmerge = useUnmergeCharacters();

  const list = useMemo(() => {
    const all = characters.data ?? [];
    const needle = query.trim().toLowerCase();
    const filtered = all.filter((character) => {
      if (roleFilter !== "all" && character.role !== roleFilter) return false;
      if (unconnectedOnly && (counts.data?.get(character.id) ?? 0) > 0) return false;
      if (needle.length === 0) return true;
      return (
        character.name.toLowerCase().includes(needle) ||
        character.aliases.some((alias) => alias.toLowerCase().includes(needle))
      );
    });
    // Pinned first, then the chosen order (manual = the writer's own order_key).
    return [...filtered].sort((a, b) => {
      const pinDiff = (pins.has(b.id) ? 1 : 0) - (pins.has(a.id) ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "role")
        return (
          (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name)
        );
      if (sortBy === "scenes") return b.sceneCount - a.sceneCount || a.name.localeCompare(b.name);
      return 0;
    });
  }, [characters.data, counts.data, query, unconnectedOnly, roleFilter, sortBy, pins]);

  const onAdd = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0 || projectId === null) return;
    setNewName("");
    await create.mutateAsync({ projectId, name }).catch(() => undefined);
  };

  const onExportCsv = () => {
    if (!matrix.data) return;
    const csv = relationshipsToCsv(matrix.data.edges, matrix.data.characters, matrix.data.groups);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "relationships.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const onMerge = async () => {
    if (projectId === null || mergeSource === null || mergeTarget === null) return;
    setMerging(true);
    try {
      const merged = await merge.mutateAsync({
        projectId,
        sourceId: mergeSource,
        targetId: mergeTarget,
      });
      const moved =
        merged.relationshipsMoved +
        merged.scenesMoved +
        merged.mentionsMoved +
        merged.galleryMoved +
        merged.fieldsMoved +
        merged.timelineMoved +
        merged.povMoved +
        merged.plotlinesMoved;
      const dropped =
        merged.relationshipsDropped +
        merged.scenesDropped +
        merged.galleryDropped +
        merged.fieldsDropped;
      pushUndo(format(messages.dossier.merged, { moved, dropped }), async () => {
        await unmerge.mutateAsync({ projectId, result: merged });
      });
      setMergeSource(null);
      setMergeTarget(null);
    } finally {
      setMerging(false);
    }
  };

  const openCell = (pair: { sourceId: UUID; targetId: UUID }, cell: MatrixCell | null) => {
    setSheet({ edge: cell?.primary ?? null, pair });
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{messages.people.heading}</h1>
        <fieldset className="sl-segmented sl-fieldset ml-auto">
          <legend className="sr-only">{messages.relationships.heading}</legend>
          {(["list", "matrix", "graph"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="sl-segment"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              data-testid={`sl-mode-${option}`}
            >
              {messages.relationships[option]}
            </button>
          ))}
        </fieldset>
      </header>

      {mode === "list" ? (
        <>
          <input
            className="sl-input"
            placeholder={messages.people.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={messages.people.searchPlaceholder}
          />

          <div className="flex flex-wrap items-center gap-2" data-testid="sl-people-toolbar">
            <select
              className="sl-input sl-select"
              value={sortBy}
              aria-label={messages.people.sortLabel}
              data-testid="sl-people-sort"
              onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            >
              <option value="manual">{messages.people.sortManual}</option>
              <option value="name">{messages.people.sortName}</option>
              <option value="role">{messages.people.sortRole}</option>
              <option value="scenes">{messages.people.sortScenes}</option>
            </select>
            <select
              className="sl-input sl-select"
              value={roleFilter}
              aria-label={messages.people.filterLabel}
              data-testid="sl-people-role"
              onChange={(event) => setRoleFilter(event.target.value)}
            >
              <option value="all">{messages.people.filterAll}</option>
              {(
                ["protagonist", "antagonist", "major", "supporting", "minor", "mentioned"] as const
              ).map((role) => (
                <option key={role} value={role}>
                  {messages.roles[role]}
                </option>
              ))}
            </select>
          </div>

          <form className="flex gap-2" onSubmit={(event) => void onAdd(event)}>
            <input
              className="sl-input flex-1"
              placeholder={messages.people.addPlaceholder}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              aria-label={messages.people.addPlaceholder}
            />
            <button
              type="submit"
              className="sl-btn"
              aria-label={messages.step3.addButton}
              disabled={newName.trim().length === 0 || projectId === null}
            >
              +
            </button>
          </form>

          <label className="sl-check">
            <input
              type="checkbox"
              checked={unconnectedOnly}
              onChange={(event) => setUnconnectedOnly(event.target.checked)}
              data-testid="sl-people-no-rel"
            />
            {messages.relationships.none}
          </label>

          {list.length === 0 ? (
            <p className="text-sm text-muted">{messages.people.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((character) => (
                <li key={character.id} className="sl-card flex items-center gap-2 p-3">
                  <Link
                    to="/people/$characterId"
                    params={{ characterId: character.id }}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: character.color }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{character.name}</span>
                      {character.oneLine.length > 0 ? (
                        <span className="block truncate text-xs text-muted">
                          {character.oneLine}
                        </span>
                      ) : null}
                    </span>
                    <span className="sl-chip" data-testid="sl-rel-count">
                      {counts.data?.get(character.id) ?? 0}
                    </span>
                    <span className="sl-chip" data-testid="sl-scene-count">
                      {character.sceneCount}
                    </span>
                    <span className="sl-chip">{messages.roles[character.role]}</span>
                  </Link>
                  <button
                    type="button"
                    className="sl-btn-small"
                    data-testid={`sl-pin-${character.id}`}
                    data-active={pins.has(character.id)}
                    aria-label={`${pins.has(character.id) ? messages.people.unpin : messages.people.pin}: ${character.name}`}
                    onClick={() => {
                      const next = new Set(pins);
                      if (next.has(character.id)) next.delete(character.id);
                      else next.add(character.id);
                      setPins(next);
                      writePins(projectId, next);
                    }}
                  >
                    {pins.has(character.id) ? "★" : "☆"}
                  </button>
                  <button
                    type="button"
                    className="sl-btn-small"
                    data-testid="sl-merge-open"
                    aria-label={`${messages.dossier.merge}: ${character.name}`}
                    onClick={() => setMergeSource(character.id)}
                  >
                    ⇄
                  </button>
                </li>
              ))}
            </ul>
          )}

          {mergeSource !== null ? (
            <div className="sl-card flex flex-col gap-3 p-4" data-testid="sl-merge-sheet">
              <h2 className="text-sm font-semibold">{messages.dossier.mergeTitle}</h2>
              <p className="text-xs text-muted">{messages.dossier.mergeExplain}</p>
              <fieldset className="flex flex-col gap-2">
                <legend className="sr-only">{messages.dossier.mergeTitle}</legend>
                {list
                  .filter((candidate) => candidate.id !== mergeSource)
                  .map((candidate) => (
                    <label key={candidate.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="merge-target"
                        data-testid="sl-merge-target"
                        value={candidate.id}
                        checked={mergeTarget === candidate.id}
                        onChange={() => setMergeTarget(candidate.id)}
                      />
                      {candidate.name}
                    </label>
                  ))}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="sl-btn sl-btn-primary"
                  data-testid="sl-merge-confirm"
                  disabled={mergeTarget === null || merging}
                  onClick={() => void onMerge()}
                >
                  {messages.dossier.mergeConfirm}
                </button>
                <button
                  type="button"
                  className="sl-btn"
                  onClick={() => {
                    setMergeSource(null);
                    setMergeTarget(null);
                  }}
                >
                  {messages.common.cancel}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {mode !== "list" ? (
        <div className="sl-rel-actions">
          <button
            type="button"
            className="sl-btn-small"
            onClick={() => setSheet({ edge: null })}
            data-testid="sl-rel-add"
          >
            {messages.relationships.add}
          </button>
          <button
            type="button"
            className="sl-btn-small"
            onClick={() => setGroupsOpen(true)}
            data-testid="sl-rel-groups"
          >
            {messages.relationships.group}
          </button>
          <button type="button" className="sl-btn-small" onClick={onExportCsv}>
            {messages.matrix.exportCsv}
          </button>
        </div>
      ) : null}

      {mode !== "list" && matrix.data && projectId ? (
        <Suspense fallback={<p className="text-sm text-muted">{messages.common.loading}</p>}>
          {mode === "matrix" ? (
            <RelationshipMatrix
              characters={matrix.data.characters}
              edges={matrix.data.edges}
              groups={matrix.data.groups}
              onOpenCell={openCell}
            />
          ) : (
            <RelationshipGraph
              projectId={projectId}
              characters={matrix.data.characters}
              edges={matrix.data.edges}
              groups={matrix.data.groups}
              scenes={tree.data?.scenes ?? []}
              pinned={positions.data ?? {}}
              onEditEdge={(edge) => setSheet({ edge })}
            />
          )}
          <section className="sl-rel-all">
            <h2 className="sl-label">{messages.relationships.list}</h2>
            <RelationshipList
              edges={matrix.data.edges}
              characters={matrix.data.characters}
              groups={matrix.data.groups}
              onEdit={(edge) => setSheet({ edge })}
            />
          </section>
        </Suspense>
      ) : null}

      {sheet && projectId ? (
        <EdgeSheet
          projectId={projectId}
          characters={matrix.data?.characters ?? []}
          groups={matrix.data?.groups ?? []}
          scenes={tree.data?.scenes ?? []}
          initial={sheet.pair}
          edge={sheet.edge}
          onClose={() => setSheet(null)}
        />
      ) : null}

      {groupsOpen && projectId ? (
        <GroupSheet
          projectId={projectId}
          groups={matrix.data?.groups ?? []}
          edges={matrix.data?.edges ?? []}
          onClose={() => setGroupsOpen(false)}
        />
      ) : null}
    </div>
  );
}
