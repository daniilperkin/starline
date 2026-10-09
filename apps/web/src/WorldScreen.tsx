import {
  buildCategoryTree,
  LORE_KIND_GLYPHS,
  type LoreCategory,
  type LoreCategoryNode,
  type LoreEntrySummary,
  messages,
  type UUID,
} from "@starline/core";
import { useEffect, useMemo, useState } from "react";
import {
  useCreateLoreCategory,
  useCreateLoreEntry,
  useDeleteLoreCategory,
  useLoreCategories,
  useLoreEntries,
  useMoveLoreEntry,
  useProjects,
  useSeedLoreTaxonomy,
} from "./data";
import { LoreSheet } from "./LoreSheet";

/** World tab v1 (PLAN slice 6): the category tree plus the entry list of the chosen node. */

const ALL = "all" as const;
const UNCATEGORISED = "none" as const;
type Selection = typeof ALL | typeof UNCATEGORISED | UUID;

function kindLabel(entry: LoreEntrySummary): string {
  if (entry.kind === "custom") return entry.customKindLabel || messages.kinds.custom;
  return messages.kinds[entry.kind];
}

export function WorldScreen() {
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
  const [newCategory, setNewCategory] = useState("");
  const [newEntry, setNewEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cascadeFor, setCascadeFor] = useState<{ id: UUID; count: number } | null>(null);

  const projectId = project?.id ?? null;

  // First visit seeds the nine default categories (idempotent command, spec §3.7 taxonomy).
  const categoryList = categories.data;
  useEffect(() => {
    if (projectId === null || categoryList === undefined) return;
    if (categoryList.length === 0) void seed.mutateAsync(projectId).catch(() => undefined);
  }, [projectId, categoryList, seed]);

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
    return (entries.data ?? []).filter((entry) => {
      if (selection === UNCATEGORISED && entry.categoryId !== null) return false;
      if (selection !== ALL && selection !== UNCATEGORISED && entry.categoryId !== selection) {
        return false;
      }
      if (needle.length === 0) return true;
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.summary.toLowerCase().includes(needle) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(needle))
      );
    });
  }, [entries.data, query, selection]);

  const selectedCategory =
    selection === ALL || selection === UNCATEGORISED
      ? null
      : ((categories.data ?? []).find((category) => category.id === selection) ?? null);

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
        <span className="sl-chip">
          {messages.world.entries.replace("{n}", String(entries.data?.length ?? 0))}
        </span>
      </header>

      <input
        className="sl-input"
        placeholder={messages.world.search}
        aria-label={messages.world.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {error !== null ? (
        <p className="sl-error" role="alert">
          {error}
        </p>
      ) : null}

      <section aria-label={messages.world.heading} className="flex flex-col gap-1">
        <button
          type="button"
          className="sl-tree-row"
          data-active={selection === ALL}
          onClick={() => setSelection(ALL)}
        >
          <span aria-hidden="true">✧</span>
          <span className="flex-1 text-left">{messages.tabs.world}</span>
          <span className="text-xs text-muted">{entries.data?.length ?? 0}</span>
        </button>
        {tree.map((node) => (
          <CategoryRow
            key={node.id}
            node={node}
            depth={0}
            selection={selection}
            onSelect={setSelection}
            onDelete={(category) => void onDeleteCategory(category)}
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

      {visible.length === 0 ? (
        <p className="text-sm text-muted">
          {query.trim().length > 0
            ? messages.world.noResults.replace("{query}", query.trim())
            : messages.world.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
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
        <div className="sl-cascade" role="alertdialog" aria-label={messages.world.deleteCategory}>
          <p className="text-sm">
            {messages.world.cascadeWarning.replace("{n}", String(cascadeFor.count))}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="sl-btn"
              onClick={() => {
                const category = (categories.data ?? []).find((row) => row.id === cascadeFor.id);
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

function CategoryRow({
  node,
  depth,
  selection,
  onSelect,
  onDelete,
}: {
  node: LoreCategoryNode;
  depth: number;
  selection: Selection;
  onSelect: (id: UUID) => void;
  onDelete: (category: LoreCategory) => void;
}) {
  return (
    <>
      <div className="sl-tree-group">
        <button
          type="button"
          className="sl-tree-row"
          data-active={selection === node.id}
          style={{ paddingLeft: `${12 + depth * 14}px` }}
          onClick={() => onSelect(node.id)}
        >
          <span aria-hidden="true">{node.icon || "◦"}</span>
          <span className="flex-1 text-left">{node.name}</span>
          <span className="text-xs text-muted">{node.entryCount}</span>
        </button>
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
