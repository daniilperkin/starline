import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  buildCategoryTree,
  format,
  getLorePositions,
  LORE_KIND_GLYPHS,
  LORE_KINDS,
  type LoreCategory,
  type LoreCategoryNode,
  type LoreEntrySummary,
  type LorePositions,
  listTagsForEntities,
  messages,
  plural,
  setLorePositions,
  type UUID,
} from "@starline/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  useCreateLoreCategory,
  useCreateLoreEntry,
  useDeleteLoreCategory,
  useLoreCategories,
  useLoreEntries,
  useMoveLoreCategory,
  useMoveLoreEntry,
  useProjects,
  useSeedLoreTaxonomy,
} from "./data";
import { LoreSheet } from "./LoreSheet";
import { useNavigationStore } from "./navigation";
import { useSessionStore } from "./session";
import { takeSnapshot } from "./snapshots";
import { TimelineView } from "./timeline/TimelineView";

/** World tab v1 (PLAN slice 6): the category tree plus the entry list of the chosen node. */

const ALL = "all" as const;
const UNCATEGORISED = "none" as const;
type Selection = typeof ALL | typeof UNCATEGORISED | UUID;

function kindLabel(entry: LoreEntrySummary): string {
  if (entry.kind === "custom") return entry.customKindLabel || messages.kinds.custom;
  return messages.kinds[entry.kind];
}

export function WorldScreen() {
  const session = useSessionStore((state) => state.session);
  const projects = useProjects();
  const project = projects.data?.[0] ?? null;
  const categories = useLoreCategories(project?.id ?? null);
  const entries = useLoreEntries(project?.id ?? null);
  const seed = useSeedLoreTaxonomy();
  const createCategory = useCreateLoreCategory();
  const createEntry = useCreateLoreEntry();
  const deleteCategory = useDeleteLoreCategory();
  const moveEntry = useMoveLoreEntry();

  const [selection, setSelection] = useState<Selection>(ALL);
  const [query, setQuery] = useState("");
  const [openEntryId, setOpenEntryId] = useState<UUID | null>(null);
  const [mode, setMode] = useState<"lore" | "timeline">("lore");
  const [view, setView] = useState<"tree" | "cards" | "map">("tree");
  const [kindFilter, setKindFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [orphanOnly, setOrphanOnly] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newEntry, setNewEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cascadeFor, setCascadeFor] = useState<{ id: UUID; count: number } | null>(null);

  const projectId = project?.id ?? null;

  // Slice 31: the tags per entry (one batched query) and the map's pins.
  const tagsByEntry = useQuery({
    queryKey: ["loreTags", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      const ids = (entries.data ?? []).map((entry) => entry.id);
      return listTagsForEntities(session.driver, "lore_entry", ids);
    },
  });
  const positions = useQuery({
    queryKey: ["lorePositions", session?.name ?? null, projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      if (!session || !projectId) throw new Error("no project open");
      return getLorePositions(session.driver, projectId);
    },
  });
  const tagNames = useMemo(() => {
    const names = new Set<string>();
    for (const tags of tagsByEntry.data?.values() ?? []) {
      for (const tag of tags) names.add(tag.name);
    }
    return [...names].sort();
  }, [tagsByEntry.data]);

  // A search hit, backlink row or check item can ask for one specific entry (slice 7).
  const pendingTarget = useNavigationStore((state) => state.target);
  const clearTarget = useNavigationStore((state) => state.clear);
  useEffect(() => {
    if (pendingTarget?.kind !== "lore") return;
    setOpenEntryId(pendingTarget.id);
    clearTarget();
  }, [pendingTarget, clearTarget]);

  // First visit seeds the nine default categories (idempotent command, spec §3.7 taxonomy).
  const categoryList = categories.data;
  useEffect(() => {
    if (projectId === null || categoryList === undefined) return;
    if (categoryList.length === 0) void seed.mutateAsync(projectId).catch(() => undefined);
  }, [projectId, categoryList, seed]);

  const moveCategory = useMoveLoreCategory();
  // A tap must still select: the drag only starts after 8 px of movement, which is the same
  // constraint the scene list uses.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  /**
   * Drop a category onto another (or onto the World root) and it moves there. The command refuses
   * cycles, so dropping a parent into its own child surfaces the error instead of corrupting the
   * tree. Ordering appends after the target's last child.
   */
  const onCategoryDrop = async (draggedId: UUID, targetId: UUID | null) => {
    if (projectId === null || draggedId === targetId) return;
    const siblings = (categories.data ?? []).filter((category) =>
      targetId === null ? category.parentId === null : category.parentId === targetId,
    );
    const lastKey = siblings
      .map((category) => category.orderKey)
      .sort()
      .at(-1);
    const orderKey = between(lastKey ?? "", "zzzz");
    await moveCategory
      .mutateAsync({ projectId, categoryId: draggedId, parentId: targetId, orderKey })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const tree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries.data ?? []) {
      if (entry.categoryId) counts.set(entry.categoryId, (counts.get(entry.categoryId) ?? 0) + 1);
    }
    return buildCategoryTree(categories.data ?? [], counts);
  }, [categories.data, entries.data]);

  const uncategorisedCount = useMemo(
    () => (entries.data ?? []).filter((entry) => entry.categoryId === null).length,
    [entries.data],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const tags = tagsByEntry.data;
    return (entries.data ?? []).filter((entry) => {
      if (selection === UNCATEGORISED && entry.categoryId !== null) return false;
      if (selection !== ALL && selection !== UNCATEGORISED && entry.categoryId !== selection) {
        return false;
      }
      if (kindFilter.length > 0 && entry.kind !== kindFilter) return false;
      if (orphanOnly && (tags?.get(entry.id)?.length ?? 0) > 0) return false;
      if (tagFilter.length > 0) {
        const names = (tags?.get(entry.id) ?? []).map((tag) => tag.name);
        if (!names.includes(tagFilter)) return false;
      }
      if (needle.length === 0) return true;
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.summary.toLowerCase().includes(needle) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(needle))
      );
    });
  }, [entries.data, query, selection, kindFilter, tagFilter, orphanOnly, tagsByEntry.data]);

  const selectedCategory =
    selection === ALL || selection === UNCATEGORISED
      ? null
      : ((categories.data ?? []).find((category) => category.id === selection) ?? null);

  const moveUnderName =
    selection === ALL || selection === UNCATEGORISED
      ? null
      : ((categories.data ?? []).find((category) => category.id === selection)?.name ?? null);

  const onAddCategory = async () => {
    const name = newCategory.trim();
    if (name.length === 0 || projectId === null) return;
    setNewCategory("");
    const parentId = selectedCategory?.id ?? null;
    await createCategory
      .mutateAsync({ projectId, name, parentId })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const onAddEntry = async () => {
    const name = newEntry.trim();
    if (name.length === 0 || projectId === null) return;
    setNewEntry("");
    const kind = selectedCategory?.defaultKind ?? "location";
    const categoryId = selectedCategory?.id ?? null;
    await createEntry
      .mutateAsync({ projectId, name, kind, categoryId })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const onDeleteCategory = async (category: LoreCategory) => {
    if (projectId === null) return;
    const count = subtreeEntryCount(tree, category.id);
    if (count > 0 && cascadeFor?.id !== category.id) {
      setCascadeFor({ id: category.id, count });
      return;
    }
    setCascadeFor(null);
    // A category cascade can remove a whole subtree in one tap; snapshot first.
    if (session !== null) {
      await takeSnapshot(session, "pre_bulk_delete", messages.world.deleteCategory);
    }
    await deleteCategory
      .mutateAsync({ projectId, categoryId: category.id, cascade: count > 0 })
      .then(() => {
        if (selection === category.id) setSelection(ALL);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const onMoveEntry = async (entry: LoreEntrySummary, direction: -1 | 1) => {
    if (projectId === null) return;
    const siblings = (entries.data ?? []).filter(
      (row) => row.categoryId === entry.categoryId && row.parentEntryId === entry.parentEntryId,
    );
    const index = siblings.findIndex((row) => row.id === entry.id);
    const target = siblings[index + direction];
    if (!target) return;
    const orderKey =
      direction === -1
        ? between(target.orderKey, entry.orderKey)
        : between(entry.orderKey, target.orderKey);
    await moveEntry
      .mutateAsync({
        projectId,
        entryId: entry.id,
        categoryId: entry.categoryId,
        parentEntryId: entry.parentEntryId,
        orderKey,
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  if (project === null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{messages.world.heading}</h1>
        <p className="text-sm text-muted">{messages.world.empty}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{messages.world.heading}</h1>
        <span className="sl-chip">{plural(messages.world.entries, entries.data?.length ?? 0)}</span>
        <fieldset className="sl-segmented sl-fieldset ml-auto">
          <legend className="sr-only">{messages.world.heading}</legend>
          {(["lore", "timeline"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="sl-segment"
              aria-pressed={mode === option}
              data-testid={`sl-world-${option}`}
              onClick={() => setMode(option)}
            >
              {option === "lore" ? messages.timeline.lore : messages.timeline.heading}
            </button>
          ))}
        </fieldset>
      </header>

      {mode === "timeline" ? null : (
        <fieldset className="sl-segmented sl-fieldset" data-testid="sl-world-views">
          <legend className="sr-only">{messages.world.view}</legend>
          {(["tree", "cards", "map"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="sl-segment"
              aria-pressed={view === option}
              data-testid={`sl-world-view-${option}`}
              onClick={() => setView(option)}
            >
              {messages.world[option]}
            </button>
          ))}
        </fieldset>
      )}

      {mode === "timeline" && projectId !== null ? <TimelineView projectId={projectId} /> : null}

      {mode === "timeline" ? null : (
        <>
          <input
            className="sl-input"
            placeholder={messages.world.search}
            aria-label={messages.world.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="flex flex-wrap items-center gap-2" data-testid="sl-world-filters">
            <select
              className="sl-select"
              aria-label={messages.world.kindFilter}
              data-testid="sl-world-kind"
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value)}
            >
              <option value="">{messages.world.kindFilter}</option>
              {LORE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {messages.kinds[kind]}
                </option>
              ))}
            </select>
            <select
              className="sl-select"
              aria-label={messages.world.tagFilter}
              data-testid="sl-world-tag"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="">{messages.world.tagFilter}</option>
              {tagNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <label className="sl-check">
              <input
                type="checkbox"
                data-testid="sl-world-orphans"
                checked={orphanOnly}
                onChange={(event) => setOrphanOnly(event.target.checked)}
              />
              {messages.world.orphans}
            </label>
          </div>

          {error !== null ? (
            <p className="sl-error" role="alert">
              {error}
            </p>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event: DragEndEvent) => {
              const target = event.over?.id;
              if (target === undefined) return;
              void onCategoryDrop(
                event.active.id as UUID,
                target === ROOT_DROPPABLE ? null : (target as UUID),
              );
            }}
          >
            <section aria-label={messages.world.heading} className="flex flex-col gap-1">
              <RootRow
                count={entries.data?.length ?? 0}
                active={selection === ALL}
                onSelect={() => setSelection(ALL)}
              />
              {tree.map((node) => (
                <CategoryRow
                  key={node.id}
                  node={node}
                  depth={0}
                  selection={selection}
                  onSelect={setSelection}
                  onDelete={(category) => void onDeleteCategory(category)}
                  onMoveUnder={(parentId, _parentName) =>
                    void onCategoryDrop(node.id, parentId).then(() => setError(null))
                  }
                  moveUnderName={moveUnderName}
                  selectedId={selection}
                />
              ))}
              {uncategorisedCount > 0 ? (
                <button
                  type="button"
                  className="sl-tree-row"
                  data-active={selection === UNCATEGORISED}
                  onClick={() => setSelection(UNCATEGORISED)}
                >
                  <span aria-hidden="true">◦</span>
                  <span className="flex-1 text-left">{messages.world.uncategorised}</span>
                  <span className="text-xs text-muted">{uncategorisedCount}</span>
                </button>
              ) : null}
            </section>
          </DndContext>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onAddCategory();
            }}
          >
            <input
              className="sl-input flex-1"
              placeholder={messages.world.newCategoryName}
              aria-label={messages.world.newCategory}
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
            />
            <button type="submit" className="sl-btn" disabled={newCategory.trim().length === 0}>
              {messages.world.newCategory}
            </button>
          </form>

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onAddEntry();
            }}
          >
            <input
              className="sl-input flex-1"
              placeholder={messages.world.newEntryName}
              aria-label={messages.world.newEntry}
              value={newEntry}
              onChange={(event) => setNewEntry(event.target.value)}
            />
            <button type="submit" className="sl-btn" disabled={newEntry.trim().length === 0}>
              {messages.world.newEntry}
            </button>
          </form>

          {view === "map" && visible.length > 0 ? (
            <LoreMap
              entries={visible}
              positions={positions.data ?? {}}
              onPin={async (entryId, x, y) => {
                if (!session || projectId === null) return;
                await setLorePositions(session.driver, projectId, {
                  ...(positions.data ?? {}),
                  [entryId]: { x, y },
                });
                await positions.refetch();
              }}
              onOpen={setOpenEntryId}
            />
          ) : null}

          {view === "map" ? null : visible.length === 0 ? (
            <p className="text-sm text-muted">
              {query.trim().length > 0
                ? messages.world.noResults.replace("{query}", query.trim())
                : messages.world.empty}
            </p>
          ) : (
            <ul className={view === "cards" ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2"}>
              {visible.map((entry) => (
                <li key={entry.id} className="sl-lore-card">
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 p-4 text-left"
                    onClick={() => setOpenEntryId(entry.id)}
                  >
                    <span className="sl-lore-glyph" aria-hidden="true">
                      {LORE_KIND_GLYPHS[entry.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {entry.pinned ? <span aria-hidden="true">✦ </span> : null}
                        {entry.name}
                      </span>
                      {entry.summary.length > 0 ? (
                        <span className="block truncate text-xs text-muted">{entry.summary}</span>
                      ) : null}
                    </span>
                    <span className="sl-chip">{kindLabel(entry)}</span>
                  </button>
                  <div className="flex justify-end gap-1 px-2 pb-2">
                    <button
                      type="button"
                      className="sl-btn"
                      aria-label={`${messages.world.moveUp}: ${entry.name}`}
                      onClick={() => void onMoveEntry(entry, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="sl-btn"
                      aria-label={`${messages.world.moveDown}: ${entry.name}`}
                      onClick={() => void onMoveEntry(entry, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {cascadeFor !== null ? (
            <div
              className="sl-cascade"
              role="alertdialog"
              aria-label={messages.world.deleteCategory}
            >
              <p className="text-sm">{plural(messages.world.cascadeWarning, cascadeFor.count)}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="sl-btn"
                  onClick={() => {
                    const category = (categories.data ?? []).find(
                      (row) => row.id === cascadeFor.id,
                    );
                    if (category) void onDeleteCategory(category);
                  }}
                >
                  {messages.world.cascadeConfirm}
                </button>
                <button type="button" className="sl-btn" onClick={() => setCascadeFor(null)}>
                  {messages.common.cancel}
                </button>
              </div>
            </div>
          ) : null}

          {openEntryId !== null ? (
            <LoreSheet
              projectId={project.id}
              entryId={openEntryId}
              categories={categories.data ?? []}
              entries={entries.data ?? []}
              onClose={() => setOpenEntryId(null)}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/** The map view: entries pinned on a canvas; drag to place, tap to open. */
function LoreMap({
  entries,
  positions,
  onPin,
  onOpen,
}: {
  entries: LoreEntrySummary[];
  positions: LorePositions;
  onPin: (entryId: UUID, x: number, y: number) => Promise<void>;
  onOpen: (entryId: UUID) => void;
}) {
  const [drag, setDrag] = useState<{ id: UUID; x: number; y: number } | null>(null);
  // The auto-layout: a loose grid until the writer pins an entry by hand.
  const STEP_X = 130;
  const STEP_Y = 110;
  return (
    <div className="sl-lore-map" data-testid="sl-lore-map">
      {entries.map((entry, index) => {
        const pinned = positions[entry.id];
        const x = drag?.id === entry.id ? drag.x : (pinned?.x ?? (index % 3) * STEP_X + 12);
        const y =
          drag?.id === entry.id ? drag.y : (pinned?.y ?? Math.floor(index / 3) * STEP_Y + 12);
        return (
          <button
            key={entry.id}
            type="button"
            className="sl-lore-pin"
            data-testid="sl-lore-pin"
            style={{ left: x, top: y }}
            onPointerDown={(event) => {
              (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
              setDrag({ id: entry.id, x, y });
            }}
            onPointerMove={(event) => {
              if (drag?.id !== entry.id) return;
              setDrag({ id: entry.id, x: drag.x + event.movementX, y: drag.y + event.movementY });
            }}
            onPointerUp={() => {
              if (drag?.id !== entry.id) return;
              void onPin(entry.id, drag.x, drag.y);
              setDrag(null);
            }}
            onClick={() => onOpen(entry.id)}
          >
            <span aria-hidden="true">{LORE_KIND_GLYPHS[entry.kind]}</span>
            <span className="truncate">{entry.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function subtreeEntryCount(nodes: LoreCategoryNode[], categoryId: UUID): number {
  const find = (list: LoreCategoryNode[]): LoreCategoryNode | null => {
    for (const node of list) {
      if (node.id === categoryId) return node;
      const child = find(node.children);
      if (child) return child;
    }
    return null;
  };
  const node = find(nodes);
  if (!node) return 0;
  const sum = (current: LoreCategoryNode): number =>
    current.entryCount + current.children.reduce((total, child) => total + sum(child), 0);
  return sum(node);
}

/** The World root doubles as the drop target for un-nesting. */
const ROOT_DROPPABLE = "lore-root";

function RootRow({
  count,
  active,
  onSelect,
}: {
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROPPABLE });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className="sl-tree-row"
      data-active={active}
      data-drop={isOver}
      onClick={onSelect}
    >
      <span aria-hidden="true">✧</span>
      <span className="flex-1 text-left">{messages.tabs.world}</span>
      <span className="text-xs text-muted">{count}</span>
    </button>
  );
}

function CategoryRow({
  node,
  depth,
  selection,
  onSelect,
  onDelete,
  onMoveUnder,
  moveUnderName,
  selectedId,
}: {
  node: LoreCategoryNode;
  depth: number;
  selection: Selection;
  onSelect: (id: UUID) => void;
  onDelete: (category: LoreCategory) => void;
  onMoveUnder: (parentId: UUID | null, parentName: string) => void;
  moveUnderName: string | null;
  selectedId: Selection;
}) {
  const drag = useDraggable({ id: node.id });
  const drop = useDroppable({ id: node.id });
  const canMoveUnder = moveUnderName !== null && selectedId !== node.id && selectedId !== ALL;
  return (
    <>
      <div
        ref={drop.setNodeRef}
        className="sl-tree-group"
        data-dragging={drag.isDragging}
        data-drop={drop.isOver}
      >
        <button
          ref={drag.setNodeRef}
          type="button"
          className="sl-tree-row"
          data-active={selection === node.id}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          {...drag.listeners}
          {...drag.attributes}
          onClick={() => onSelect(node.id)}
        >
          <span aria-hidden="true">{node.icon || "◦"}</span>
          <span className="flex-1 text-left">{node.name}</span>
          <span className="text-xs text-muted">{node.entryCount}</span>
        </button>
        {canMoveUnder ? (
          <button
            type="button"
            className="sl-tree-delete"
            data-testid="sl-tree-nest"
            aria-label={`${format(messages.world.moveUnder, { parent: moveUnderName ?? "" })}: ${node.name}`}
            onClick={() => onMoveUnder(selectedId as UUID, moveUnderName ?? "")}
          >
            ↳
          </button>
        ) : null}
        <button
          type="button"
          className="sl-tree-delete"
          aria-label={`${messages.world.deleteCategory}: ${node.name}`}
          onClick={() => onDelete(node)}
        >
          ✕
        </button>
      </div>
      {node.children.map((child) => (
        <CategoryRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selection={selection}
          onSelect={onSelect}
          onDelete={onDelete}
          onMoveUnder={onMoveUnder}
          moveUnderName={moveUnderName}
          selectedId={selectedId}
        />
      ))}
    </>
  );
}

/** Fractional index between two keys — mirrors the core's orderKeyBetween for UI-side moves. */
function between(a: string, b: string): string {
  if (a < b) {
    const mid = `${a}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}`;
    return mid < b ? mid : `${a}a`;
  }
  return `${b}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}`;
}
