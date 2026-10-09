import {
  type MatrixCell,
  messages,
  type RelationshipEdge,
  relationshipsToCsv,
  type UUID,
} from "@starline/core";
import { Link } from "@tanstack/react-router";
import { type FormEvent, lazy, Suspense, useMemo, useState } from "react";
import {
  useCharacters,
  useCreateCharacter,
  useGraphPositions,
  useProjects,
  useRelationshipCounts,
  useRelationshipMatrix,
  useSceneTree,
} from "./data";
import { EdgeSheet } from "./relationships/EdgeSheet";
import { GroupSheet } from "./relationships/GroupSheet";
import { RelationshipList } from "./relationships/RelationshipList";

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
export function PeopleScreen() {
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;
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
  const [sheet, setSheet] = useState<{
    edge: RelationshipEdge | null;
    pair?: { sourceId: UUID; targetId: UUID };
  } | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);

  const list = useMemo(() => {
    const all = characters.data ?? [];
    const needle = query.trim().toLowerCase();
    return all.filter((character) => {
      if (unconnectedOnly && (counts.data?.get(character.id) ?? 0) > 0) return false;
      if (needle.length === 0) return true;
      return (
        character.name.toLowerCase().includes(needle) ||
        character.aliases.some((alias) => alias.toLowerCase().includes(needle))
      );
    });
  }, [characters.data, counts.data, query, unconnectedOnly]);

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
                <li key={character.id}>
                  <Link
                    to="/people/$characterId"
                    params={{ characterId: character.id }}
                    className="sl-card flex items-center gap-3 p-4"
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
                    <span className="sl-chip">{messages.roles[character.role]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
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
